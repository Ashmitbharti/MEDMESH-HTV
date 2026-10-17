# Member flow

## Phone checks

1. Hold either Home button for 3 seconds. Releasing early must cancel activation.
2. For yourself, use your saved ID, scan a MedMesh QR, or continue without an ID. For another person, your own ID must never be attached automatically.
3. Reject an unrelated QR. Deny camera permission and use manual ID entry or skip.
4. Answer the five questions. Wait over 5 seconds on one: it must show no response recorded, keep the request saved, and allow a late answer.
5. Allow location access, then try again with access denied or services off. A landmark must remain usable. Only use phone coordinates when you are with the person needing help.
6. Close and reopen the app with an active questionnaire. Its deadline and answers must survive.
7. Complete the questions, add a condition update and change the landmark. Reopen offline and check that everything remains saved.
8. Cancel the request and create another. The previous cancellation must remain in Recent requests with a retry button until acknowledged.
9. Retry without hardware: the app must explain that no mesh node is connected, with no claim that responders were dispatched.

## Hardware integration boundary

`setMeshTransport(adapter)` accepts an adapter with `send(packet)`. It returns a verified acknowledgment containing `requestId`, `revision`, `stage`, and `source`.

Stages: `node_received` from `node`; `command_received`, `responder_dispatched`, and `cancellation_received` from `command_centre`.

Use `receiveReceipt(receipt)` for later acknowledgments. The hardware integration must authenticate the sender and validate the wire protocol before calling it. The app checks matching IDs, revision bounds, allowed sources, duplicate receipts and cancellation revisions. An older receipt cannot confirm newer details.

The packet is a logical payload. Bluetooth transport, LoRa encoding/fragmentation, automatic retries, command centre intake and responder dispatch are still to be integrated. No mock transport is enabled in the app.

Automated tests use synthetic data and mocked storage, location and transport. Camera scanning, physical GPS accuracy and phone background behavior require the phone checks above.
