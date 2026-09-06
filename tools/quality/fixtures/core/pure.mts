export function increment(value: Readonly<{ count: number }>): Readonly<{ count: number }> {
  return { count: value.count + 1 };
}
