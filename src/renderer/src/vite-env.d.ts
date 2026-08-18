/// <reference types="vite/client" />

import type { KickrDesktopApi } from "@shared/ipc/api";

declare global {
  interface Window {
    kickr: KickrDesktopApi;
  }
}
