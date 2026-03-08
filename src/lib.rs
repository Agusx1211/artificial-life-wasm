#[cfg(feature = "parallel")]
use std::ptr;

use rand::{Rng, RngCore, SeedableRng, rngs::SmallRng, seq::index};
use rand_distr::{Binomial, Distribution};
#[cfg(feature = "parallel")]
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

#[cfg(all(feature = "parallel", target_arch = "wasm32"))]
pub use wasm_bindgen_rayon::init_thread_pool;

const TAPE_SIZE: usize = 64;
const TAPE_SIDE: usize = 8;
const PAIR_TAPE_SIZE: usize = TAPE_SIZE * 2;
#[cfg(feature = "parallel")]
const PARALLEL_PAIR_BATCH: usize = 128;
const MAX_ITERATIONS: usize = 1 << 13;
const MAX_NEIGHBORS: usize = 24;
const INVALID_INDEX: u32 = u32::MAX;

const LT: u8 = b'<';
const GT: u8 = b'>';
const LB: u8 = b'{';
const RB: u8 = b'}';
const MINUS: u8 = b'-';
const PLUS: u8 = b'+';
const DOT: u8 = b'.';
const COMMA: u8 = b',';
const LBRACK: u8 = b'[';
const RBRACK: u8 = b']';

const FALLBACK_COLOR: [u8; 4] = [20, 20, 20, 255];
const OPCODE_COLORS: [[u8; 4]; 10] = [
    [239, 71, 111, 255],
    [255, 209, 102, 255],
    [6, 214, 160, 255],
    [17, 138, 178, 255],
    [255, 127, 80, 255],
    [131, 56, 236, 255],
    [58, 134, 255, 255],
    [255, 190, 11, 255],
    [139, 201, 38, 255],
    [255, 89, 94, 255],
];
const OPCODES: [u8; 10] = [LT, GT, LB, RB, MINUS, PLUS, DOT, COMMA, LBRACK, RBRACK];

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

#[wasm_bindgen]
pub struct Universe {
    width: usize,
    height: usize,
    num_programs: usize,
    num_cells: usize,
    mutation_rate: f64,
    mutation_dist: Option<Binomial>,
    rng: SmallRng,
    epoch: u32,
    programs: Vec<u8>,
    neighbors: Vec<u32>,
    neighbor_counts: Vec<u8>,
    order: Vec<u32>,
    proposals: Vec<u32>,
    pairs: Vec<u32>,
    last_partners: Vec<u32>,
    taken: Vec<u8>,
    frame: Vec<u8>,
    frame_dirty: bool,
    opcode_percent: f64,
    color_lut: [[u8; 4]; 256],
    opcode_mask: [u8; 256],
}

#[wasm_bindgen]
impl Universe {
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: u32,
        height: u32,
        seed: u32,
        mutation_rate: f64,
    ) -> Result<Universe, JsValue> {
        if width == 0 || height == 0 {
            return Err(JsValue::from_str("width and height must be > 0"));
        }
        if !(0.0..=1.0).contains(&mutation_rate) {
            return Err(JsValue::from_str(
                "mutation_rate must be between 0.0 and 1.0",
            ));
        }

        let width = width as usize;
        let height = height as usize;
        let num_programs = width
            .checked_mul(height)
            .ok_or_else(|| JsValue::from_str("grid is too large"))?;
        let num_cells = num_programs
            .checked_mul(TAPE_SIZE)
            .ok_or_else(|| JsValue::from_str("grid is too large"))?;
        let canvas_width = width
            .checked_mul(TAPE_SIDE)
            .ok_or_else(|| JsValue::from_str("canvas is too large"))?;
        let canvas_height = height
            .checked_mul(TAPE_SIDE)
            .ok_or_else(|| JsValue::from_str("canvas is too large"))?;

        let mut universe = Universe {
            width,
            height,
            num_programs,
            num_cells,
            mutation_rate,
            mutation_dist: None,
            rng: SmallRng::seed_from_u64(seed as u64),
            epoch: 0,
            programs: vec![0; num_cells],
            neighbors: vec![INVALID_INDEX; num_programs * MAX_NEIGHBORS],
            neighbor_counts: vec![0; num_programs],
            order: (0..num_programs as u32).collect(),
            proposals: vec![INVALID_INDEX; num_programs],
            pairs: vec![0; num_programs],
            last_partners: vec![INVALID_INDEX; num_programs],
            taken: vec![0; num_programs],
            frame: vec![0; canvas_width * canvas_height * 4],
            frame_dirty: true,
            opcode_percent: 0.0,
            color_lut: build_color_lut(),
            opcode_mask: build_opcode_mask(),
        };

        universe.refresh_mutation_distribution()?;
        universe.rebuild_neighborhoods();
        universe.randomize_programs();
        universe.render();

        Ok(universe)
    }

    pub fn canvas_width(&self) -> u32 {
        (self.width * TAPE_SIDE) as u32
    }

    pub fn canvas_height(&self) -> u32 {
        (self.height * TAPE_SIDE) as u32
    }

    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    pub fn opcode_percent(&self) -> f64 {
        self.opcode_percent
    }

    pub fn frame_ptr(&self) -> *const u8 {
        self.frame.as_ptr()
    }

    pub fn frame_len(&self) -> usize {
        self.frame.len()
    }

    pub fn program_ptr(&self, program_index: u32) -> Result<usize, JsValue> {
        let index = self.validate_program_index(program_index)?;
        Ok(self.programs.as_ptr() as usize + index * TAPE_SIZE)
    }

    pub fn program_len(&self) -> u32 {
        TAPE_SIZE as u32
    }

    pub fn thread_count(&self) -> u32 {
        current_thread_count()
    }

    pub fn neighbor_count(&self, program_index: u32) -> Result<u32, JsValue> {
        let index = self.validate_program_index(program_index)?;
        Ok(self.neighbor_counts[index] as u32)
    }

    pub fn neighbor_at(&self, program_index: u32, slot: u32) -> Result<i32, JsValue> {
        let index = self.validate_program_index(program_index)?;
        let slot = slot as usize;
        let neighbor_count = self.neighbor_counts[index] as usize;
        if slot >= neighbor_count {
            return Ok(-1);
        }

        Ok(self.neighbors[index * MAX_NEIGHBORS + slot] as i32)
    }

    pub fn last_partner(&self, program_index: u32) -> Result<i32, JsValue> {
        let index = self.validate_program_index(program_index)?;
        let partner = self.last_partners[index];
        if partner == INVALID_INDEX {
            return Ok(-1);
        }

        Ok(partner as i32)
    }

    pub fn create_pair_inspector(
        &self,
        left_index: u32,
        right_index: u32,
    ) -> Result<PairInspector, JsValue> {
        let left = self.validate_program_index(left_index)?;
        let right = self.validate_program_index(right_index)?;
        Ok(PairInspector::from_programs(&self.programs, left, right))
    }

    pub fn step_epochs(&mut self, epochs: u32) {
        for _ in 0..epochs {
            self.run_epoch();
        }
        self.frame_dirty = true;
    }

    pub fn render(&mut self) {
        if !self.frame_dirty {
            return;
        }

        let canvas_width = self.width * TAPE_SIDE;
        let mut opcode_count = 0usize;

        for y in 0..self.height {
            for x in 0..self.width {
                let program_index = (y * self.width + x) * TAPE_SIZE;
                let pixel_x = x * TAPE_SIDE;
                let pixel_y = y * TAPE_SIDE;

                for cell in 0..TAPE_SIZE {
                    let value = self.programs[program_index + cell];
                    opcode_count += self.opcode_mask[value as usize] as usize;

                    let local_x = cell % TAPE_SIDE;
                    let local_y = cell / TAPE_SIDE;
                    let pixel_index = ((pixel_y + local_y) * canvas_width + pixel_x + local_x) * 4;

                    self.frame[pixel_index..pixel_index + 4]
                        .copy_from_slice(&self.color_lut[value as usize]);
                }
            }
        }

        self.opcode_percent = 100.0 * opcode_count as f64 / self.num_cells as f64;
        self.frame_dirty = false;
    }
}

impl Universe {
    fn validate_program_index(&self, program_index: u32) -> Result<usize, JsValue> {
        let index = program_index as usize;
        if index >= self.num_programs {
            return Err(JsValue::from_str("program index is out of bounds"));
        }

        Ok(index)
    }

    fn refresh_mutation_distribution(&mut self) -> Result<(), JsValue> {
        self.mutation_dist = if self.mutation_rate == 0.0 {
            None
        } else {
            Some(
                Binomial::new(self.num_cells as u64, self.mutation_rate)
                    .map_err(|_| JsValue::from_str("invalid mutation_rate"))?,
            )
        };
        Ok(())
    }

    fn randomize_programs(&mut self) {
        self.rng.fill_bytes(&mut self.programs);
        self.epoch = 0;
        self.frame_dirty = true;
    }

    fn rebuild_neighborhoods(&mut self) {
        for y in 0..self.height {
            let y_lo = y.saturating_sub(2);
            let y_hi = (y + 2).min(self.height - 1);

            for x in 0..self.width {
                let x_lo = x.saturating_sub(2);
                let x_hi = (x + 2).min(self.width - 1);
                let idx = y * self.width + x;
                let mut count = 0usize;

                for ny in y_lo..=y_hi {
                    for nx in x_lo..=x_hi {
                        if nx == x && ny == y {
                            continue;
                        }

                        self.neighbors[idx * MAX_NEIGHBORS + count] = (ny * self.width + nx) as u32;
                        count += 1;
                    }
                }

                self.neighbor_counts[idx] = count as u8;
            }
        }
    }

    fn run_epoch(&mut self) {
        self.shuffle_order();
        self.build_proposals();
        let pair_count = self.select_pairs();
        run_epoch_pairs(&mut self.programs, &self.pairs[..pair_count * 2]);

        self.apply_background_mutation();
        self.epoch = self.epoch.saturating_add(1);
    }

    fn shuffle_order(&mut self) {
        for idx in (1..self.order.len()).rev() {
            let swap_idx = self.rng.random_range(0..=idx);
            self.order.swap(idx, swap_idx);
        }
    }

    fn build_proposals(&mut self) {
        for program_idx in 0..self.num_programs {
            let neighbor_count = self.neighbor_counts[program_idx] as usize;
            if neighbor_count == 0 {
                self.proposals[program_idx] = INVALID_INDEX;
                continue;
            }

            let offset = program_idx * MAX_NEIGHBORS;
            let choice = self.rng.random_range(0..neighbor_count);
            self.proposals[program_idx] = self.neighbors[offset + choice];
        }
    }

    fn select_pairs(&mut self) -> usize {
        self.taken.fill(0);
        self.last_partners.fill(INVALID_INDEX);
        let mut pair_count = 0usize;

        for &program in &self.order {
            let left = program as usize;
            let right = self.proposals[left];
            if right == INVALID_INDEX {
                continue;
            }

            let right = right as usize;
            if self.taken[left] != 0 || self.taken[right] != 0 {
                continue;
            }

            self.taken[left] = 1;
            self.taken[right] = 1;
            self.last_partners[left] = right as u32;
            self.last_partners[right] = left as u32;
            self.pairs[pair_count * 2] = left as u32;
            self.pairs[pair_count * 2 + 1] = right as u32;
            pair_count += 1;
        }

        pair_count
    }

    fn apply_background_mutation(&mut self) {
        let Some(distribution) = &self.mutation_dist else {
            return;
        };

        let mutation_count = distribution.sample(&mut self.rng) as usize;
        if mutation_count == 0 {
            return;
        }

        let selected = index::sample(&mut self.rng, self.num_cells, mutation_count);
        for idx in selected.iter() {
            self.programs[idx] = self.rng.random();
        }
    }
}

#[cfg(feature = "parallel")]
fn run_epoch_pairs(programs: &mut [u8], pairs: &[u32]) {
    let programs_ptr = programs.as_mut_ptr() as usize;

    pairs
        .par_chunks_exact(PARALLEL_PAIR_BATCH * 2)
        .for_each(|pair_batch| {
            for pair in pair_batch.chunks_exact(2) {
                // Pair selection guarantees that each program appears at most once in a batch,
                // so every worker writes to disjoint tape regions.
                unsafe {
                    run_pair_at(programs_ptr as *mut u8, pair[0] as usize, pair[1] as usize);
                }
            }
        });

    for pair in pairs
        .par_chunks_exact(PARALLEL_PAIR_BATCH * 2)
        .remainder()
        .chunks_exact(2)
    {
        unsafe {
            run_pair_at(programs_ptr as *mut u8, pair[0] as usize, pair[1] as usize);
        }
    }
}

#[cfg(not(feature = "parallel"))]
fn run_epoch_pairs(programs: &mut [u8], pairs: &[u32]) {
    for pair in pairs.chunks_exact(2) {
        run_pair(programs, pair[0] as usize, pair[1] as usize);
    }
}

#[cfg(not(feature = "parallel"))]
fn run_pair(programs: &mut [u8], left: usize, right: usize) {
    let left_start = left * TAPE_SIZE;
    let right_start = right * TAPE_SIZE;
    let mut tape = [0u8; PAIR_TAPE_SIZE];

    tape[..TAPE_SIZE].copy_from_slice(&programs[left_start..left_start + TAPE_SIZE]);
    tape[TAPE_SIZE..].copy_from_slice(&programs[right_start..right_start + TAPE_SIZE]);
    run_tape(&mut tape);

    programs[left_start..left_start + TAPE_SIZE].copy_from_slice(&tape[..TAPE_SIZE]);
    programs[right_start..right_start + TAPE_SIZE].copy_from_slice(&tape[TAPE_SIZE..]);
}

#[cfg(feature = "parallel")]
unsafe fn run_pair_at(programs_ptr: *mut u8, left: usize, right: usize) {
    let left_ptr = unsafe { programs_ptr.add(left * TAPE_SIZE) };
    let right_ptr = unsafe { programs_ptr.add(right * TAPE_SIZE) };
    let mut tape = [0u8; PAIR_TAPE_SIZE];

    unsafe {
        ptr::copy_nonoverlapping(left_ptr, tape.as_mut_ptr(), TAPE_SIZE);
        ptr::copy_nonoverlapping(right_ptr, tape.as_mut_ptr().add(TAPE_SIZE), TAPE_SIZE);
    }
    run_tape(&mut tape);
    unsafe {
        ptr::copy_nonoverlapping(tape.as_ptr(), left_ptr, TAPE_SIZE);
        ptr::copy_nonoverlapping(tape.as_ptr().add(TAPE_SIZE), right_ptr, TAPE_SIZE);
    }
}

#[cfg(feature = "parallel")]
fn current_thread_count() -> u32 {
    rayon::current_num_threads() as u32
}

#[cfg(not(feature = "parallel"))]
fn current_thread_count() -> u32 {
    1
}

const HALT_REASON_NONE: u8 = 0;
const HALT_REASON_PC_EXIT: u8 = 1;
const HALT_REASON_UNMATCHED_BRACKET: u8 = 2;
const HALT_REASON_ITERATION_LIMIT: u8 = 3;

struct TapeState {
    pc: isize,
    head0: usize,
    head1: usize,
}

impl TapeState {
    fn new() -> Self {
        Self {
            pc: 0,
            head0: 0,
            head1: 0,
        }
    }
}

#[wasm_bindgen]
pub struct PairInspector {
    left_index: u32,
    right_index: u32,
    initial_tape: Vec<u8>,
    tape: Vec<u8>,
    state: TapeState,
    steps: u32,
    halt_reason: u8,
    halted: bool,
}

#[wasm_bindgen]
impl PairInspector {
    pub fn left_index(&self) -> u32 {
        self.left_index
    }

    pub fn right_index(&self) -> u32 {
        self.right_index
    }

    pub fn tape_ptr(&self) -> *const u8 {
        self.tape.as_ptr()
    }

    pub fn tape_len(&self) -> usize {
        self.tape.len()
    }

    pub fn pc(&self) -> i32 {
        self.state.pc as i32
    }

    pub fn head0(&self) -> u32 {
        self.state.head0 as u32
    }

    pub fn head1(&self) -> u32 {
        self.state.head1 as u32
    }

    pub fn steps(&self) -> u32 {
        self.steps
    }

    pub fn halted(&self) -> bool {
        self.halted
    }

    pub fn halt_reason(&self) -> String {
        match self.halt_reason {
            HALT_REASON_PC_EXIT => "pc exited tape".to_string(),
            HALT_REASON_UNMATCHED_BRACKET => "unmatched bracket".to_string(),
            HALT_REASON_ITERATION_LIMIT => "iteration limit".to_string(),
            _ => "running".to_string(),
        }
    }

    pub fn reset(&mut self) {
        self.tape.copy_from_slice(&self.initial_tape);
        self.state = TapeState::new();
        self.steps = 0;
        self.halt_reason = HALT_REASON_NONE;
        self.halted = false;
    }

    pub fn step(&mut self) -> bool {
        if self.halted {
            return false;
        }

        if self.steps >= MAX_ITERATIONS as u32 {
            self.halted = true;
            self.halt_reason = HALT_REASON_ITERATION_LIMIT;
            return false;
        }

        let (advanced, halt_reason) = step_tape_machine(&mut self.tape, &mut self.state);
        if advanced {
            self.steps += 1;
        }

        if let Some(reason) = halt_reason {
            self.halted = true;
            self.halt_reason = reason;
        } else if self.steps >= MAX_ITERATIONS as u32 {
            self.halted = true;
            self.halt_reason = HALT_REASON_ITERATION_LIMIT;
        }

        advanced
    }
}

impl PairInspector {
    fn from_programs(programs: &[u8], left: usize, right: usize) -> Self {
        let left_start = left * TAPE_SIZE;
        let right_start = right * TAPE_SIZE;
        let mut tape = vec![0u8; PAIR_TAPE_SIZE];

        tape[..TAPE_SIZE].copy_from_slice(&programs[left_start..left_start + TAPE_SIZE]);
        tape[TAPE_SIZE..].copy_from_slice(&programs[right_start..right_start + TAPE_SIZE]);

        Self {
            left_index: left as u32,
            right_index: right as u32,
            initial_tape: tape.clone(),
            tape,
            state: TapeState::new(),
            steps: 0,
            halt_reason: HALT_REASON_NONE,
            halted: false,
        }
    }
}

fn run_tape(tape: &mut [u8]) {
    let mut state = TapeState::new();

    for _ in 0..MAX_ITERATIONS {
        let (_, halt_reason) = step_tape_machine(tape, &mut state);
        if halt_reason.is_some() {
            break;
        }
    }
}

fn seek_match(
    tape: &[u8],
    pc: isize,
    step: isize,
    open_token: u8,
    close_token: u8,
) -> Option<isize> {
    let mut depth = 1usize;
    let mut cursor = pc + step;

    while (0..tape.len() as isize).contains(&cursor) {
        match tape[cursor as usize] {
            token if token == open_token => depth += 1,
            token if token == close_token => {
                depth -= 1;
                if depth == 0 {
                    return Some(cursor);
                }
            }
            _ => {}
        }
        cursor += step;
    }

    None
}

fn step_tape_machine(tape: &mut [u8], state: &mut TapeState) -> (bool, Option<u8>) {
    if !(0..tape.len() as isize).contains(&state.pc) {
        return (false, Some(HALT_REASON_PC_EXIT));
    }

    match tape[state.pc as usize] {
        LT => state.head0 = (state.head0 + tape.len() - 1) % tape.len(),
        GT => state.head0 = (state.head0 + 1) % tape.len(),
        LB => state.head1 = (state.head1 + tape.len() - 1) % tape.len(),
        RB => state.head1 = (state.head1 + 1) % tape.len(),
        MINUS => tape[state.head0] = tape[state.head0].wrapping_sub(1),
        PLUS => tape[state.head0] = tape[state.head0].wrapping_add(1),
        DOT => tape[state.head1] = tape[state.head0],
        COMMA => tape[state.head0] = tape[state.head1],
        LBRACK if tape[state.head0] == 0 => {
            let Some(target) = seek_match(tape, state.pc, 1, LBRACK, RBRACK) else {
                return (false, Some(HALT_REASON_UNMATCHED_BRACKET));
            };
            state.pc = target;
        }
        RBRACK if tape[state.head0] != 0 => {
            let Some(target) = seek_match(tape, state.pc, -1, RBRACK, LBRACK) else {
                return (false, Some(HALT_REASON_UNMATCHED_BRACKET));
            };
            state.pc = target;
        }
        _ => {}
    }

    state.pc += 1;
    let halt_reason = if !(0..tape.len() as isize).contains(&state.pc) {
        Some(HALT_REASON_PC_EXIT)
    } else {
        None
    };

    (true, halt_reason)
}

fn build_color_lut() -> [[u8; 4]; 256] {
    let mut lut = [FALLBACK_COLOR; 256];
    for (opcode, color) in OPCODES.into_iter().zip(OPCODE_COLORS) {
        lut[opcode as usize] = color;
    }
    lut
}

fn build_opcode_mask() -> [u8; 256] {
    let mut mask = [0u8; 256];
    for opcode in OPCODES {
        mask[opcode as usize] = 1;
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corner_has_expected_neighbor_count() {
        let universe = Universe::new(5, 5, 1, 0.0).expect("valid universe");
        assert_eq!(universe.neighbor_counts[0], 8);
    }

    #[test]
    fn center_has_full_neighbor_count() {
        let universe = Universe::new(5, 5, 1, 0.0).expect("valid universe");
        let center = 2 * 5 + 2;
        assert_eq!(universe.neighbor_counts[center], 24);
    }

    #[test]
    fn frame_size_tracks_canvas_size() {
        let universe = Universe::new(3, 2, 1, 0.0).expect("valid universe");
        assert_eq!(universe.canvas_width(), 24);
        assert_eq!(universe.canvas_height(), 16);
        assert_eq!(universe.frame_len(), 24 * 16 * 4);
    }

    #[test]
    fn pair_inspector_steps_copy_instruction() {
        let mut programs = vec![0u8; PAIR_TAPE_SIZE];
        programs[0] = DOT;
        programs[1] = RB;
        programs[2] = PLUS;
        programs[3] = COMMA;

        let mut inspector = PairInspector::from_programs(&programs, 0, 1);
        assert!(inspector.step());
        assert_eq!(inspector.head1(), 0);
        assert!(inspector.step());
        assert_eq!(inspector.head1(), 1);
        assert!(inspector.step());
        assert_eq!(inspector.tape[0], DOT.wrapping_add(1));
        assert!(inspector.step());
        assert_eq!(inspector.tape[0], inspector.tape[1]);
    }

    #[test]
    fn pair_inspector_reset_restores_initial_state() {
        let mut programs = vec![0u8; PAIR_TAPE_SIZE];
        programs[0] = PLUS;

        let mut inspector = PairInspector::from_programs(&programs, 0, 1);
        assert!(inspector.step());
        assert_eq!(inspector.tape[0], PLUS.wrapping_add(1));
        inspector.reset();
        assert_eq!(inspector.tape[0], PLUS);
        assert_eq!(inspector.pc(), 0);
        assert_eq!(inspector.steps(), 0);
        assert!(!inspector.halted());
    }
}
