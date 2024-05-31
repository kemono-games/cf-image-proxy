import decodeJpeg, { init as initJpegWasm } from "@jsquash/jpeg/decode";
import decodePng, { init as initPngWasm } from "@jsquash/png/decode";
import encodeAvif, { init as initAvifWasm } from "@jsquash/avif/encode";
import encodeWebp, { init as initWebpWasm } from "@jsquash/webp/encode";
import resize, { initResize } from "@jsquash/resize";

import AVIF_ENC_WASM from "../node_modules/@jsquash/avif/codec/enc/avif_enc.wasm";
import JPEG_DEC_WASM from "../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import PNG_DEC_WASM from "../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import RESIZE_WASM from "../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm";
import WEBP_ENC_WASM from "../node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm";

const MONTH_IN_SECONDS = 30 * 24 * 60 * 60;
const CDN_CACHE_AGE = 6 * MONTH_IN_SECONDS; // 6 Months

const decodeImage = async (buffer, format) => {
  if (format === "jpeg" || format === "jpg") {
    // @Note, we need to manually initialise the wasm module here from wasm import at top of file
    await initJpegWasm(JPEG_DEC_WASM);
    return decodeJpeg(buffer);
  } else if (format === "png") {
    // @Note, we need to manually initialise the wasm module here from wasm import at top of file
    await initPngWasm(PNG_DEC_WASM);
    return decodePng(buffer);
  }

  throw new Error(`Unsupported format: ${format}`);
};

async function handleRequest(request, _env, ctx) {
  const { url } = request;
  const accept = request.headers.get("accept");

  let format = "jpg";
  if (/image\/avif/.test(accept)) {
    format = "avif";
  } else if (/image\/webp/.test(accept)) {
    format = "webp";
  }
  // if (/image\/webp/.test(accept)) {
  //   format = "webp";
  // }

  const u = new URL(url);
  let imgUrl = u.searchParams.get("url");
  if (!imgUrl) {
    return new Response("Missing url query parameter", { status: 400 });
  }
  const extension = new URL(imgUrl).pathname.split(".").pop();

  const cacheKeyUrl = imgUrl.toString().replace(`.${extension}`, `.${format}`);
  const cacheKey = new Request(cacheKeyUrl, request);
  const cache = caches.default;

  const supportedExtensions = ["jpg", "jpeg", "png"];
  if (!supportedExtensions.includes(extension)) {
    return new Response("Unsupported image format", {
      status: 404,
    });
  }

  let response = await cache.match(cacheKey);

  if (!response) {
    let referer = "";

    if (imgUrl.includes("i0.hdslb.com")) {
      referer = "https://www.bilibili.com/";
      imgUrl += "@200w_200H_1e_0c_50q.webp";
    } else {
      referer = "https://www.pixiv.net/";
    }
    response = await fetch(imgUrl, {
      headers: {
        referer,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
      },
    });

    if (response.status !== 200) {
      return new Response("Not found", { status: 404 });
    }

    let imageData = await decodeImage(await response.arrayBuffer(), extension);
    await initResize(RESIZE_WASM);
    const { width, height } = imageData;
    imageData = await resize(imageData, {
      width: 200,
      height: Math.round((200 * height) / width),
    });
    if (format === "webp") {
      await initWebpWasm(WEBP_ENC_WASM);
      const webpImage = await encodeWebp(imageData, { quality: 50 });
      response = new Response(webpImage, response);
      response.headers.set("Content-Type", "image/webp");
    } else if (format === "avif") {
      await initAvifWasm(AVIF_ENC_WASM);
      const avifImage = await encodeAvif(imageData, { quality: 50 });
      response = new Response(avifImage, response);
      response.headers.set("Content-Type", "image/avif");
    } else {
      response = new Response(imageData, response);
    }

    response.headers.append("Cache-Control", `s-maxage=${CDN_CACHE_AGE}`);

    // Use waitUntil so you can return the response without blocking on
    // writing to cache
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

export default {
  fetch: handleRequest,
};
