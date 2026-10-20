import type { MystApi } from '../../shared/api';

declare global {
  interface Window {
    myst: MystApi;
  }
}
