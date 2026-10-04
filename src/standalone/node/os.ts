/** Browser stand-in for node:os. */
export function tmpdir(): string {
  return '/tmp';
}

export default { tmpdir };
