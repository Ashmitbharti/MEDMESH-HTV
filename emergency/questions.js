export const questions = [
  { key: 'location', title: 'Where is help needed?', input: true, options: ['Unsure'] },
  { key: 'awake', title: 'Is the person awake and responding?', selfTitle: 'Can you stay awake and respond?', options: ['Yes', 'No', 'Unsure'] },
  { key: 'breathing', title: 'Are they breathing normally?', selfTitle: 'Are you breathing normally?', options: ['Yes', 'No', 'Unsure'] },
  { key: 'bleeding', title: 'Are they bleeding heavily?', selfTitle: 'Are you bleeding heavily?', options: ['Yes', 'No', 'Unsure'] },
  { key: 'incident', title: 'What happened?', options: ['Injury', 'Sudden illness', 'Flood or other danger', 'Unsure'] },
];

export const answerTime = 5000;

export function startQuestions(request, medmeshId, now = Date.now()) {
  if (request.phase !== 'identify') return request;
  if (medmeshId !== null && (typeof medmeshId !== 'string' || !/^[A-Z]{6}$/.test(medmeshId))) {
    throw new Error('Scan a MedMesh QR code containing a six-letter ID.');
  }
  return {
    ...request,
    medmeshId,
    phase: 'questions',
    deadline: now + answerTime,
    updatedAt: new Date(now).toISOString(),
  };
}

export function expireRequest(request, now = Date.now()) {
  const question = questions[request.questionIndex];
  if (request.phase !== 'questions' || !question || now < request.deadline
    || request.missedQuestions.includes(question.key)) return request;
  return {
    ...request,
    missedQuestions: [...request.missedQuestions, question.key],
    escalation: 'no_answer_received',
    escalatedAt: request.escalatedAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export function answerRequest(request, questionKey, answer, now = Date.now()) {
  const question = questions[request.questionIndex];
  if (request.phase !== 'questions' || question?.key !== questionKey) return request;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Choose an answer or Unsure.');
  if (!question.input && !question.options.includes(answer)) throw new Error('Choose one of the available answers.');
  const current = expireRequest(request, now);
  const next = request.questionIndex + 1;
  return {
    ...current,
    answers: { ...current.answers, [questionKey]: answer.trim().slice(0, 300) },
    questionIndex: next,
    phase: next === questions.length ? 'ready' : 'questions',
    deadline: next === questions.length ? null : now + answerTime,
    updatedAt: new Date(now).toISOString(),
  };
}
