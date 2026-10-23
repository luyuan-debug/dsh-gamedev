import test from 'node:test';
import assert from 'node:assert/strict';
import { inputRefusal } from '../dist/config.js';

// Pure dispatch admission tests. They neither execute Godot input nor establish
// cancellation/disconnection behavior in a real game.
const SEQUENCE = 'godot_input_play_sequence';
const admitted = (name, args) => assert.equal(inputRefusal(name, args), undefined);
const refused = (name, args) => {
  const reason = inputRefusal(name, args);
  assert.equal(typeof reason, 'string');
  assert.ok(reason.length > 0);
};
const key = (name, pressed, extra = {}) => ({ type: 'key', key: name, pressed, ...extra });
const action = (name, pressed, extra = {}) => ({ type: 'action', action: name, pressed, ...extra });
const mouse = (button, pressed, extra = {}) => ({ type: 'mouse', button, pressed, x: 100, y: 50, ...extra });

test('unrelated upstream tools remain governed by their own policy', () => {
  admitted('godot_health_check', {});
  admitted('godot_scripts_read', { path: 'res://game.gd' });
});
test('reviewed input diagnostics and recording do not inject held events', () => {
  for (const name of ['godot_input_get_stats', 'godot_input_record', 'godot_input_stop_recording']) admitted(name, {});
});
test('input-map configuration is distinct from runtime held input', () => {
  admitted('godot_input_map_add_action', { name: 'move_left' });
  admitted('godot_input_map_add_event', { action: 'move_left', event: { key: 'A' } });
});

test('single key/action held press and implicit default press are refused', () => {
  for (const pressed of [true, undefined]) {
    refused('godot_input_simulate_key', { key: 'D', ...(pressed === undefined ? {} : { pressed }) });
    refused('godot_input_simulate_action', { action: 'move_right', ...(pressed === undefined ? {} : { pressed }) });
  }
});

test('single explicit release remains available', () => {
  admitted('godot_input_simulate_key', { key: 'D', pressed: false });
  admitted('godot_input_simulate_action', { action: 'move_right', pressed: false });
  admitted('godot_input_simulate_mouse', { x: 100, y: 50, button: 'left', pressed: false });
});

test('mouse motion does not create a hold, button presses including wheel require pairing', () => {
  admitted('godot_input_simulate_mouse', { x: 120, y: 80 });
  admitted('godot_input_simulate_mouse', { x: 120, y: 80, button: '', pressed: true });
  for (const button of ['left', 'right', 'middle', 'wheel_up', 'wheel_down']) {
    refused('godot_input_simulate_mouse', { x: 120, y: 80, button });
    refused('godot_input_simulate_mouse', { x: 120, y: 80, button, pressed: true });
  }
});

test('short matching key/action/mouse sequences are admitted without argument mutation', () => {
  const args = { delay_ms: 100, events: [key('D', true), key('D', false), action('jump', true), action('jump', false), mouse('left', true), mouse('left', false)] };
  const before = structuredClone(args);
  admitted(SEQUENCE, args);
  assert.deepEqual(args, before);
});

test('sequence implicit pressed=true must receive an explicit release', () => {
  admitted(SEQUENCE, { events: [{ type: 'key', key: 'Space' }, key('Space', false)], delay_ms: 16 });
  refused(SEQUENCE, { events: [{ type: 'key', key: 'Space' }], delay_ms: 16 });
  refused(SEQUENCE, { events: [key('Space', false), key('Space', true)], delay_ms: 16 });
});

test('cross-type and wrong identity releases do not pair a hold', () => {
  refused(SEQUENCE, { events: [key('D', true), key('A', false)], delay_ms: 16 });
  refused(SEQUENCE, { events: [key('D', true), action('D', false)], delay_ms: 16 });
  refused(SEQUENCE, { events: [mouse('left', true), mouse('right', false)], delay_ms: 16 });
});

test('key modifier identity must match to avoid ambiguous releases', () => {
  admitted(SEQUENCE, { events: [key('A', true, { ctrl: true }), key('A', false, { ctrl: true })], delay_ms: 16 });
  refused(SEQUENCE, { events: [key('A', true, { ctrl: true }), key('A', false)], delay_ms: 16 });
  refused(SEQUENCE, { events: [key('A', true, { shift: true }), key('A', false, { alt: true })], delay_ms: 16 });
});

test('duration counts the addon timer after every event and stays strictly below five seconds', () => {
  const events = [key('D', true), key('D', false)];
  admitted(SEQUENCE, { events, delay_ms: 2499 });
  refused(SEQUENCE, { events, delay_ms: 2500 });
  refused(SEQUENCE, { events, delay_ms: 5000 });
  for (const delay_ms of [-1, 0.5, NaN, Infinity, '16']) refused(SEQUENCE, { events, delay_ms });
});

test('zero-delay replay still has a finite event-count limit', () => {
  const make = (pairs) => Array.from({ length: pairs }, () => [key('D', true), key('D', false)]).flat();
  admitted(SEQUENCE, { events: make(64), delay_ms: 0 });
  refused(SEQUENCE, { events: make(65), delay_ms: 0 });
});

test('unsupported or malformed sequence events are refused before partial injection', () => {
  const invalid = [null, [], {}, { type: 'axis', axis: 1 }, { type: 'key', key: '' }, { type: 'action', action: '' }, { type: 'mouse', button: 'wheel_left' }];
  for (const event of invalid) refused(SEQUENCE, { events: [event], delay_ms: 0 });
  refused(SEQUENCE, { events: [], delay_ms: 0 });
  refused(SEQUENCE, { events: 'key D', delay_ms: 0 });
});

test('Godot truthy coercion cannot turn a textual false into an unpaired press', () => {
  refused(SEQUENCE, { events: [key('D', 'false')], delay_ms: 0 });
  refused(SEQUENCE, { events: [key('D', true), key('D', 'false')], delay_ms: 0 });
  refused(SEQUENCE, { events: [key('D', true, { ctrl: 'false' }), key('D', false)], delay_ms: 0 });
});

test('non-finite coordinates or strengths do not reach the addon coercions', () => {
  refused(SEQUENCE, { events: [mouse('left', true, { x: Infinity }), mouse('left', false)], delay_ms: 0 });
  refused(SEQUENCE, { events: [action('jump', true, { strength: NaN }), action('jump', false)], delay_ms: 0 });
});

test('runtime testing aggregates cannot inject hidden unbalanced events around admission', () => {
  refused('godot_testing_run_test_scenario', { events: [key('D', true)], stop_after: false });
  refused('godot_testing_run_stress_test', { iterations: 1, actions: ['click'], delay_ms: 8 });
});
