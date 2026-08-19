import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ZodType } from "zod";

type Handler<I, O> = (event: IpcMainInvokeEvent, input: I) => Promise<O> | O;

export const safeHandle = <I, O>(
  channel: string,
  inputSchema: ZodType<I>,
  outputSchema: ZodType<O>,
  handler: Handler<I, O>
): void => {
  ipcMain.handle(channel, async (event, rawInput) => {
    try {
      const input = inputSchema.parse(rawInput);
      const result = await handler(event, input);
      return outputSchema.parse(result);
    } catch (error) {
      console.error(`[ipc:${channel}]`, error);
      throw error;
    }
  });
};
