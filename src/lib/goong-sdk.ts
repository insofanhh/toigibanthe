let loading: Promise<any> | null = null;

/** Load one shared SDK only when a kitchen or order map is opened. */
export function loadGoongSDK(): Promise<any> {
  const sdk = (window as any).goongjs;
  if (sdk) return Promise.resolve(sdk);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector("[data-goong-css]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href =
        "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.css";
      css.dataset.goongCss = "true";
      document.head.appendChild(css);
    }
    let script =
      document.querySelector<HTMLScriptElement>("script[data-goong]");
    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.js";
      script.dataset.goong = "true";
    }
    const timeout = setTimeout(fail, 12000);
    function cleanup() {
      clearTimeout(timeout);
      script?.removeEventListener("load", loaded);
      script?.removeEventListener("error", fail);
    }
    function loaded() {
      cleanup();
      const result = (window as any).goongjs;
      if (result) resolve(result);
      else fail();
    }
    function fail() {
      cleanup();
      script?.remove();
      reject(
        new Error("Không tải được bản đồ. Bạn vẫn có thể tìm và chọn địa chỉ."),
      );
    }
    script.addEventListener("load", loaded);
    script.addEventListener("error", fail);
    if (!script.isConnected) document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
