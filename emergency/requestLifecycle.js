const stages = ['not_sent', 'node_received', 'command_received', 'responder_dispatched'];

export function reviseRequest(current, next, now = Date.now()) {
  if (next === current) return current;
  const revision = (current.revision || 1) + 1;
  return {
    ...next,
    revision,
    updatedAt: new Date(now).toISOString(),
    cancellationRevision: next.phase === 'cancelled' ? (current.cancellationRevision || revision) : null,
  };
}

export function validReceipt(request, receipt) {
  if (!receipt || receipt.requestId !== request.id || !Number.isInteger(receipt.revision)
    || receipt.revision < 1 || receipt.revision > (request.revision || 1)) return false;
  const source = receipt.stage === 'node_received' ? 'node' : 'command_centre';
  if (receipt.source !== source) return false;
  if (receipt.stage === 'cancellation_received') {
    return request.phase === 'cancelled'
      && receipt.revision >= (request.cancellationRevision || request.revision || 1);
  }
  return stages.indexOf(receipt.stage) >= 1;
}

export function applyReceipt(request, receipt, now = Date.now()) {
  if (!validReceipt(request, receipt)) return request;

  if (receipt.stage === 'cancellation_received') {
    if (request.cancellationConfirmedAt) return request;
    return { ...request, cancellationConfirmedAt: new Date(now).toISOString() };
  }

  const rank = stages.indexOf(receipt.stage);
  if (rank < 1) return request;
  const events = request.deliveryEvents || [];
  if (events.some((event) => event.stage === receipt.stage && event.revision === receipt.revision)) return request;
  const commandRevision = rank >= 2 ? Math.max(request.commandRevision || 0, receipt.revision) : request.commandRevision || 0;
  return {
    ...request,
    deliveryStatus: stages[Math.max(stages.indexOf(request.deliveryStatus), rank)],
    nodeRevision: Math.max(request.nodeRevision || 0, receipt.revision),
    commandRevision,
    deliveryEvents: [...events, { stage: receipt.stage, revision: receipt.revision, at: new Date(now).toISOString() }],
  };
}

export function cancelRequest(request, now = Date.now()) {
  if (request.phase === 'cancelled') return request;
  return { ...request, phase: 'cancelled', deadline: null, cancelledAt: new Date(now).toISOString() };
}

export function addConditionUpdate(request, text, now = Date.now()) {
  if (request.phase === 'cancelled') throw new Error('This request has been cancelled.');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Describe the change before saving.');
  return {
    ...request,
    conditionUpdates: [...(request.conditionUpdates || []), { text: text.trim().slice(0, 500), at: new Date(now).toISOString() }],
  };
}

export function attachCoordinates(request, fix) {
  if (request.phase === 'cancelled') throw new Error('This request has been cancelled.');
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
    || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180) {
    throw new Error('The phone returned an invalid location. Enter a landmark instead.');
  }
  return { ...request, coordinates: fix };
}

export function updateLandmark(request, text) {
  if (request.phase === 'cancelled') throw new Error('This request has been cancelled.');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter an address or landmark.');
  return { ...request, coordinates: null, answers: { ...request.answers, location: text.trim().slice(0, 300) } };
}

export function deliveryLabel(request) {
  if (request.phase === 'cancelled') {
    return request.cancellationConfirmedAt ? 'Cancellation confirmed' : request.deliveryStatus === 'not_sent'
      ? 'Cancelled locally' : 'Cancellation awaiting confirmation';
  }
  return {
    not_sent: 'Saved locally · not sent',
    node_received: 'Sent to node',
    command_received: 'Received by command centre',
    responder_dispatched: 'Responder dispatched',
  }[request.deliveryStatus] || 'Delivery not confirmed';
}
