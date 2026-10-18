// ===============================
// Heltec LoRa WiFi V3 LED Sequence
// ===============================

// Assign each board one of these:
// "FIELD"
// "COMMAND"
// "RESPONDER"
// "HOSPITAL"
#define BOARD_ROLE "RESPONDER"

// LED pin
#define LED_PIN 4

// Timing
const unsigned long interval = 4000;   // normal 4-second steps
const unsigned long fieldStartup = 8000; // extended Field glow time

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
}

void loop() {
  unsigned long t = millis();

  bool shouldGlow = false;

  // Step A: Field stays ON for the first 8 seconds
  if (t < fieldStartup && strcmp(BOARD_ROLE, "FIELD") == 0) {
    shouldGlow = true;
  } else {
    // After startup, switch to normal 4-step sequence
    int step = ((t - fieldStartup) / interval) % 4;

    // Step 0: Field glows
    if (step == 0 && strcmp(BOARD_ROLE, "FIELD") == 0) {
      shouldGlow = true;
    }

    // Step 1: Command Centre glows
    if (step == 1 && strcmp(BOARD_ROLE, "COMMAND") == 0) {
      shouldGlow = true;
    }

    // Step 2: Field + Responder glow together
    if (step == 2 &&
       (strcmp(BOARD_ROLE, "FIELD") == 0 || strcmp(BOARD_ROLE, "RESPONDER") == 0)) {
      shouldGlow = true;
    }

    // Step 3: Hospital glows last
    if (step == 3 && strcmp(BOARD_ROLE, "HOSPITAL") == 0) {
      shouldGlow = true;
    }
  }

  digitalWrite(LED_PIN, shouldGlow ? HIGH : LOW);
}