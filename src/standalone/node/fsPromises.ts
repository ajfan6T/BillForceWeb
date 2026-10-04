/** Browser stand-in for node:fs/promises: saving files where the user chooses happens through downloads instead. */
const unavailable = async (): Promise<never> => {
  throw new Error('Not available in the browser');
};

export type FileHandle = never;
export const open = unavailable;
export const rm = unavailable;
export const rename = unavailable;

export default { open, rm, rename };
