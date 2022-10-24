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
    /!\[\[\b(.*\.(png|jpg|jpeg|gif|bmp))(?:[^|]*)(?:\|([^|]*))?(?:\|([^|]*))?\]\]/i;

const IMGSIZE_REGEX = /^\s*\d+(?:x\d+)?/i;
// https://regex101.com/r/kXe1en/2
const LINK_REGEX = /!\[(.*)\].*\((.*\.(png|jpg|jpeg|gif|bmp))(?:.*)\)/i;

const ALTTEXT_INVALID_REGEX = /[|[\]\n]/gi;

// https://regex101.com/r/RqgesY/2
const EXTENSION_REGEX = /\.(png|jpg|jpeg|gif|bpm)$/i;

export function parseInternalImageLink(line: string): ParsedImage | undefined {
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

export function replaceInternalImageLink(line: string, pi: ParsedImage) {
    let newImg = `![[${pi.urlOrPath} | ${pi.altText}`;
    if (pi.size) {
        newImg += `| ${pi.size}`;
    }
    newImg += `]]`;
    return line.replace(EMBED_REGEX, newImg);
}

export function parseExternalImageLink(line: string): ParsedImage | undefined {
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

export function replaceExternalImageLink(line: string, pi: ParsedImage) {
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
            // logger: (m) => console.log(m),
        });
    }

    static isImage(url: string) {
        const m = EXTENSION_REGEX.exec(url);
        if (m) {
            return m[1];
        } else {
            return false;
        }
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
                    text = OCRProcessor.sanitizeForAltText(text);
                    parsedImage.altText = text;
                    const newLine =
                        parsedImage.type === "embed"
                            ? replaceInternalImageLink(line, parsedImage)
                            : replaceExternalImageLink(line, parsedImage);
                    console.log(newLine);
                    editor.setLine(cursor.line, newLine);
                }
            }
        }
    }

    static sanitizeForAltText(text: string) {
        text = text.replace(ALTTEXT_INVALID_REGEX, " ");
        return text;
    }

    async processEmbed(embed: string) {
        const pi = parseInternalImageLink(embed);
        if(pi){
            if (!pi?.altText || !pi.altText.length) {
                console.log(pi)
                let text = await this.recognizeURL(pi.urlOrPath);
                //TODO: filter text length
                if (text && text.length > TEXT_THRESHOLD) {
                    text = OCRProcessor.sanitizeForAltText(text);
                    pi.altText = text;                   
                } else {
                    pi.altText = pi.urlOrPath;
                }
                const newContent = replaceInternalImageLink(embed, pi);
                return newContent;
            } 
            return embed;
        } else {
            return embed;
        }


    }

    private async getImageURL(imagePathOrURL: string, extension?: string) {
        if (!extension) {
            const me = EXTENSION_REGEX.exec(imagePathOrURL);
            if (!me) return undefined;
            extension = me[1];
        }
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

                if (
                    !imgUrl &&
                    //@ts-ignore
                    this.plugin.app.vault.config.attachmentFolderPath
                ) {
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

    async recognizeURL(src: string) {
        const imgUrl = await this.getImageURL(src);
        if (imgUrl) {
            return this.recognize(imgUrl);
        }
    }

    async recognize(img: string) {
        await this.worker.load();
        await this.worker.loadLanguage("eng");
        await this.worker.initialize("eng");
        const {
            data: { text },
        } = await this.worker.recognize(img);
        // await this.worker.terminate();
        return text;
    }
}
