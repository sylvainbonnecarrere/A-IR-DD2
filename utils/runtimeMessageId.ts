let runtimeMessageSequence = 0;

export function generateRuntimeMessageId(suffix?: string): string {
  runtimeMessageSequence += 1;
  return `msg-${Date.now()}-${runtimeMessageSequence}${suffix ? `-${suffix}` : ''}`;
}
