// Ant Design reads layout APIs even in DOM-only interaction tests.
// Real responsive/layout evidence is collected separately in a browser.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    }),
  });
  class TestResizeObserver {
    observe() {} unobserve() {} disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: TestResizeObserver });
  Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });
  // jsdom has no pseudo-element layout; retain its normal element implementation.
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element) => getComputedStyle(element);
}
