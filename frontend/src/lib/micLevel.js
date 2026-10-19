// Shared microphone level (0..1). MicCapture writes it, the 3D shield, the wave backdrop and the signal
// ribbon read it every frame, so nothing re-renders when the level changes.
export const micLevel = { current: 0 };
