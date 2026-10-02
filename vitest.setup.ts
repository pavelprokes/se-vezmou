import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Úklid DOM po každém testu (v prostředí node se nic nevykresluje a cleanup je prázdný).
afterEach(() => {
  cleanup();
});
