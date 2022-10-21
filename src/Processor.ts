import TesseractPlugin from "src/main";
import { createWorker, Worker } from "tesseract.js";
import path from "path";
import fs from "fs/promises";
import { Editor, FileSystemAdapter, normalizePath, requestUrl } from "obsidian";

interface ParsedImage {
    altText?: string;
    urlOrPath: string;
    extension: string;
    size?: string;
    type: "embed" | "link";
    regex: RegExpExecArray;
}
const TEXT_THRESHOLD = 5;
// https://regex101.com/r/uPu8E2/1
const EMBED_REGEX =
    /!\[\[\b(.*\.(png|jpg|jpeg|gif|bmp|svg))(?:[^|]*)(?:\|([^|]*))?(?:\|([^|]*))?\]\]/i;

const IMGSIZE_REGEX = /\d+(?:x\d+)?/i;
// https://regex101.com/r/kXe1en/1
const LINK_REGEX = /!\[(.*)\].*\((.*\.(png|jpg|jpeg|gif|bmp|svg))(?:.*)\)/i;

const ALTTEXT_INVALID_REGEX = /[|[\]\n]/gi;

function parseInternalImageLink(line: string): ParsedImage | undefined {
    const m = EMBED_REGEX.exec(line);
    if (m !== null) {
        let size = undefined;
        let altText = undefined;
        if (m[3]) {
            if (m[4]) {
                altText = m[3].trim();
                size = m[4].trim();
            } else {
                const msize = IMGSIZE_REGEX.exec(m[3]);
                if (msize) {
                    size = m[3].trim();
                } else {
                    altText = m[3].trim();
                }
            }
        }

        const ret: ParsedImage = {
            urlOrPath: m[1].trim(),
            extension: m[2].trim(),
            size,
            altText,
            type: "embed",
            regex: m,
        };
        return ret;
    }
}

function replaceInternalImageLink(line: string, pi: ParsedImage) {
    let newImg = `![[${pi.urlOrPath} | ${pi.altText}`;
    if (pi.size) {
        newImg += `| ${pi.size}`;
    }
    newImg += `]]`;
    return line.replace(EMBED_REGEX, newImg);
}

function parseExternalImageLink(line: string): ParsedImage | undefined {
    const m = LINK_REGEX.exec(line);
    if (m !== null) {
        const n = m.length;
        let size = undefined;
        let altText = undefined;
        if (n > 3) {
            if (n === 5) {
                altText = m[1].trim();
                size = m[2].trim();
            } else {
                const msize = IMGSIZE_REGEX.exec(m[1]);
                if (msize) {
                    size = m[3].trim();
                } else {
                    altText = m[3].trim();
                }
            }
        }
        const ret: ParsedImage = {
            altText,
            size,
            urlOrPath: m[n - 2],
            extension: m[n - 1],
            type: "link",
            regex: m,
        };
        return ret;
    }
}

function replaceExternalImageLink(line: string, pi: ParsedImage) {
    let newImg = `![${pi.altText}`;
    if (pi.size) {
        newImg += `| ${pi.size}`;
    }
    newImg += `](${pi.urlOrPath})`;
    return line.replace(LINK_REGEX, newImg);
}

export class OCRProcessor {
    plugin: TesseractPlugin;
    basePath: any;
    worker: Worker;

    /**
     *
     */
    constructor(plugin: TesseractPlugin) {
        this.plugin = plugin;
        this.basePath = path.join(
            (this.plugin.app.vault.adapter as any).getBasePath(),
            this.plugin.manifest.dir || ""
        );
        this.worker = createWorker({
            cachePath: this.basePath,
            logger: (m) => console.log(m),
        });
    }

    async processEditor(editor: Editor) {
        const cursor = editor.getCursor();

        const line = editor.getLine(cursor.line);
        let parsedImage = parseInternalImageLink(line);
        if (!parsedImage) {
            parsedImage = parseExternalImageLink(line);
        }
        if (parsedImage) {
            const imgUrl = await this.getImageURL(
                parsedImage.urlOrPath,
                parsedImage.extension
            );
            if (imgUrl) {
                let text = await this.recognize(imgUrl);
                console.log(text);
                if (text && text.length > TEXT_THRESHOLD) {
                    text = text.replace(ALTTEXT_INVALID_REGEX, " ");
                    parsedImage.altText = text;
                    const newLine = parsedImage.type === "embed" 
                    ? replaceInternalImageLink(line, parsedImage)
                    : replaceExternalImageLink(line, parsedImage)
                    ;
                    console.log(newLine);
                    editor.setLine(cursor.line, newLine);
                }
            }
        }
    }


    private async getImageURL(imagePathOrURL: string, extension: string) {
        if (imagePathOrURL.toLowerCase().startsWith("http")) {
            const resp = await requestUrl({ url: imagePathOrURL });
            // let   tmp = (new TextDecoder("utf-8")).decode(resp.arrayBuffer); //to UTF-8 text.
            // tmp = unescape(encodeURIComponent(tmp));         //to binary-string.
            // tmp = btoa(tmp);      //BASE64.
            const uint = new Uint8Array(resp.arrayBuffer);
            const binary = String.fromCharCode.apply(null, uint);
            const imgUrl = `data:image/${extension};base64,${btoa(binary)}`;
            console.log(imgUrl);
            return imgUrl;
        } else {
            const adapter = this.plugin.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                const normalizedPath = normalizePath(imagePathOrURL);
                //@ts-ignore
                let fullPath = adapter.getFullRealPath(
                    normalizedPath
                ) as string;
                let imgUrl = await this.processImage(fullPath, extension);

                //@ts-ignore
                if (!imgUrl && this.plugin.app.vault.config.attachmentFolderPath) {
                    //@ts-ignore
                    fullPath = adapter.getFullRealPath(
                        path.join(
                            //@ts-ignore
                            this.plugin.app.vault.config.attachmentFolderPath,
                            normalizedPath
                        )
                    ) as string;
                    imgUrl = await this.processImage(fullPath, extension);
                }

                return imgUrl;
            }
        }
    }


    private async processImage(
        imgUrl: string,
        extension: string
    ): Promise<string | undefined> {
        if (!imgUrl.toUpperCase().startsWith("HTTP")) {
            try {
                const image = await fs.readFile(imgUrl, {
                    encoding: "base64",
                });
                imgUrl = `data:image/${extension};base64,${image}`;
            } catch (ex) {
                if (!(ex.code === "EISDIR" || ex.code === "ENOENT")) {
                    console.warn(ex);
                }
                return undefined;
            }
        }
        // imgUrl = imgUrl && `url(${imgUrl})`;
        return imgUrl;
    }

    async recognize(img: string) {
        await this.worker.load();
        await this.worker.loadLanguage("eng");
        await this.worker.initialize("eng");
        const {
            data: { text },
        } = await this.worker.recognize(img);
        await this.worker.terminate();
        return text;
    }

}
