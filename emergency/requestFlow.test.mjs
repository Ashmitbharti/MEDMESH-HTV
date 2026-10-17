import assert from 'node:assert/strict';
import test from 'node:test';
import { answerRequest, expireRequest, startQuestions } from './questions.js';

function pending() {
  return {
    phase: 'questions', questionIndex: 0, deadline: 5000,
    answers: {}, missedQuestions: [], escalation: null,
  };
}

test('five-second timeout flags no answer without assigning a medical condition', () => {
  const request = pending();
  assert.equal(expireRequest(request, 4999), request);
  const timedOut = expireRequest(request, 5000);
  assert.equal(timedOut.escalation, 'no_answer_received');
  assert.deepEqual(timedOut.missedQuestions, ['location']);
  assert.deepEqual(timedOut.answers, {});
  assert.equal(timedOut.questionIndex, 0);
  assert.equal(expireRequest(timedOut, 9000), timedOut);
});

test('late answers remain usable while retaining the timeout history', () => {
  const request = answerRequest(pending(), 'location', '  Library entrance  ', 7000);
  assert.equal(request.answers.location, 'Library entrance');
  assert.equal(request.questionIndex, 1);
  assert.equal(request.deadline, 12000);
  assert.deepEqual(request.missedQuestions, ['location']);
  assert.equal(request.escalation, 'no_answer_received');
});

test('stale double taps cannot answer the following question', () => {
  const request = answerRequest(pending(), 'location', 'Unsure', 1000);
  assert.equal(answerRequest(request, 'location', 'Another location', 1100), request);
  assert.throws(() => answerRequest(request, 'awake', 'Invalid answer', 1200));
});

test('five answers finish the questionnaire without claiming delivery', () => {
  let request = { ...pending(), deliveryStatus: 'not_sent' };
  for (const [index, key] of ['location', 'awake', 'breathing', 'bleeding', 'incident'].entries()) {
    request = answerRequest(request, key, 'Unsure', 1000 + index * 1000);
  }
  assert.equal(request.phase, 'ready');
  assert.equal(request.deadline, null);
  assert.equal(request.deliveryStatus, 'not_sent');
  assert.equal(Object.keys(request.answers).length, 5);
});

test('cancelled requests cannot time out or accept further answers', () => {
  const cancelled = { ...pending(), phase: 'cancelled', deadline: null };
  assert.equal(expireRequest(cancelled, 20000), cancelled);
  assert.equal(answerRequest(cancelled, 'location', 'Somewhere', 20000), cancelled);
});

test('identification never starts a timer until the ID step is completed', () => {
  const request = { ...pending(), phase: 'identify', deadline: null };
  assert.equal(expireRequest(request, 50000), request);
  const identified = startQuestions(request, 'ABCDEF', 50000);
  assert.equal(identified.phase, 'questions');
  assert.equal(identified.medmeshId, 'ABCDEF');
  assert.equal(identified.deadline, 55000);
  assert.throws(() => startQuestions(request, 'https://example.com', 50000));
  assert.equal(startQuestions(identified, 'ZYXWVU'), identified);
});

test('continuing without an ID clears any prefilled identity', () => {
  const request = { ...pending(), phase: 'identify', deadline: null, medmeshId: 'ABCDEF' };
  const result = startQuestions(request, null, 1000);
  assert.equal(result.medmeshId, null);
  assert.equal(result.deadline, 6000);
});
