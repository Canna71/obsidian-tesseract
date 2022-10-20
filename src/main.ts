import { DEFAULT_SETTINGS, TesseractSettings } from "src/Settings";
import {
    addIcon,
    FileSystemAdapter,
    MarkdownView,
    normalizePath,
    requestUrl,
} from "obsidian";

// import { MathResult } from './Extensions/ResultMarkdownChild';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { TesseractView, TESSERACT_VIEW } from "../Views/TesseractView";
import {
    App,
    finishRenderMath,
    loadMathJax,
    Modal,
    Plugin,
    WorkspaceLeaf,
} from "obsidian";
import { TesseractSettingsTab } from "src/SettingTab";

const sigma = `<path stroke="currentColor" fill="none" d="M78.6067 22.8905L78.6067 7.71171L17.8914 7.71171L48.2491 48.1886L17.8914 88.6654L78.6067 88.6654L78.6067 73.4866" opacity="1"  stroke-linecap="round" stroke-linejoin="round" stroke-width="6" />
`;
import { createWorker, Worker } from "tesseract.js";
import path from "path";
import fs from "fs/promises";

// https://github.com/naptha/tesseract.js#tesseractjs
// TODO: consider also https://www.npmjs.com/package/node-native-ocr

let gSettings: TesseractSettings;

export function getTesseractSettings() {
    return gSettings;
}

interface ParsedImage {
    altText?: string,
    urlOrPath: string,
    extension: string,
    size?:string,
    type: "embed" | "link",
    regex: RegExpExecArray
}
const TEXT_THRESHOLD = 5;
// https://regex101.com/r/uPu8E2/1
const EMBED_REGEX = /!\[\[\b(.*\.(png|jpg|jpeg|gif|bmp|svg))(?:[^|]*)(?:\|([^|]*))?(?:\|([^|]*))?\]\]/i;

const IMGSIZE_REGEX = /\d*(?:x\d+)?/i;
// https://regex101.com/r/kXe1en/1
const LINK_REGEX = /!\[(.*)\].*\((.*\.(png|jpg|jpeg|gif|bmp|svg))(?:.*)\)/i;



function parseInternalImageLink(line: string) : ParsedImage | undefined {
    const m = EMBED_REGEX.exec(line);
    if (m !== null) {
        let size = undefined;
        let altText = undefined;
        if(m[3]){
            if( m[4]){
                altText = m[3].trim();
                size = m[4].trim();
            } else {
                const msize = IMGSIZE_REGEX.exec(m[3]);
                if(msize){
                    size = m[3].trim();
                } else {
                    altText = m[3].trim();
                }
            }
        }

        const ret:ParsedImage = {
            urlOrPath: m[1].trim(),
            extension: m[2].trim(),
            size,
            altText,
            type: "embed",
            regex: m
        }
        return ret;
    }
}

function replaceInternalImageLink(line: string, pi:ParsedImage, altText: string){

    let newImg = `[[${pi.urlOrPath} | ${altText}`;
    if(pi.size){
        newImg += `| ${pi.size}`
    }
    newImg += `]]`;
    return line.replace(pi.regex[0],newImg);
}

function parseExternalImageLink(line: string) : ParsedImage | undefined{
    const m = LINK_REGEX.exec(line);
    if (m !== null) {
        const n = m.length;
        let size = undefined;
        let altText = undefined;
        if(n>3){
            if(n===5){
                altText = m[1].trim();
                size = m[2].trim();
            } else {
                const msize = IMGSIZE_REGEX.exec(m[1]);
                if(msize){
                    size = m[3].trim();
                } else {
                    altText = m[3].trim();
                }
            }
        }
        const ret:ParsedImage = {
            altText,
            size,
            urlOrPath: m[n-2],
            extension: m[n-1],
            type: "link",
            regex: m
        }
        return ret;
    }
}

export default class TesseractPlugin extends Plugin {
    settings: TesseractSettings;
    worker: Worker;
    basePath: string;

    async onload() {
        await this.loadSettings();

        this.registerView(TESSERACT_VIEW, (leaf) => new TesseractView(leaf));

        addIcon("sigma", sigma);

        this.basePath = path.join(
            (this.app.vault.adapter as any).getBasePath(),
            this.manifest.dir || ""
        );

        this.worker = createWorker({
            cachePath: this.basePath,
            logger: (m) => console.log(m),
        });

        // const text = await this.recognize("https://i2-prod.liverpoolecho.co.uk/incoming/article17096840.ece/ALTERNATES/s1200d/0_whatsappweb1_censored.jpg");

        // console.log(text);

        if (this.settings.addRibbonIcon) {
            // This creates an icon in the left ribbon.
            const ribbonIconEl = this.addRibbonIcon(
                "sigma",
                "Open Tesseract",
                (evt: MouseEvent) => {
                    this.activateView();
                }
            );
            // Perform additional things with the ribbon
            ribbonIconEl.addClass("Tesseract-ribbon-class");
        }

        this.addCommand({
            id: "test-tesseract",
            name: "test tesseract",

            editorCallback: async (editor, view) => {
                const cursor = editor.getCursor();
                
                const line = editor.getLine(cursor.line);
                let parsedImage = parseInternalImageLink(line);
                if (!parsedImage) {
                    parsedImage = parseExternalImageLink(line);
                }
                if (parsedImage) {
                    const imgUrl = await this.getImageURL(parsedImage.urlOrPath, parsedImage.extension);

                    if (imgUrl) {
                        let text = await this.recognize(imgUrl);
                        console.log(text);
                        if(text && text.length>5){
                            text = text.replace("|","");
                            parsedImage.altText = text;
                            const newLine = replaceInternalImageLink(line, parsedImage, text);
                            console.log(newLine);
                            editor.replaceRange(newLine, {line:cursor.line, ch:0});
                        }
                    }
                }
            },
        });

        this.app.workspace.onLayoutReady(() => {
            if (this.settings.showAtStartup) {
                this.activateView();
            }
        });

        this.registerCodeBlock();
        this.registerPostProcessor();
        this.registerEditorExtensions();

        this.app.workspace.on(
            "active-leaf-change",
            (leaf: WorkspaceLeaf | null) => {
                // console.log("active-leaf-change", leaf);
                if (leaf?.view instanceof MarkdownView) {
                    // @ts-expect-error, not typed
                    const editorView = leaf.view.editor.cm as EditorView;
                }
            },
            this
        );

        this.app.workspace.on(
            "codemirror",
            (cm: CodeMirror.Editor) => {
                console.log("codemirror", cm);
            },
            this
        );

        this.addSettingTab(new TesseractSettingsTab(this.app, this));
    }

    private async getImageURL(imagePathOrURL: string, extension: string) {
        if (imagePathOrURL.toLowerCase().startsWith("http")) {
            const resp = await requestUrl({url:imagePathOrURL});
            // let   tmp = (new TextDecoder("utf-8")).decode(resp.arrayBuffer); //to UTF-8 text.
            // tmp = unescape(encodeURIComponent(tmp));         //to binary-string.
            // tmp = btoa(tmp);      //BASE64.
            const uint = new Uint8Array(resp.arrayBuffer);
            const binary = String.fromCharCode.apply(null,uint);
            const imgUrl = `data:image/${extension};base64,${btoa(binary)}`;                           
            console.log(imgUrl);
            return imgUrl;
        } else {
            const adapter = this.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                const normalizedPath = normalizePath(imagePathOrURL);
                //@ts-ignore
                let fullPath = adapter.getFullRealPath(
                    normalizedPath
                ) as string;
                let imgUrl = await this.processImage(fullPath, extension);

                //@ts-ignore
                if (!imgUrl && this.app.vault.config.attachmentFolderPath) {
                    //@ts-ignore
                    fullPath = adapter.getFullRealPath(
                        path.join(
                            //@ts-ignore
                            this.app.vault.config.attachmentFolderPath,
                            normalizedPath
                        )
                    ) as string; 
                    imgUrl = await this.processImage(fullPath, extension);
                }

                return imgUrl;
            }
        }
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(TESSERACT_VIEW);
    }

    private async processImage(imgUrl: string, extension: string): Promise<string | undefined> {

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

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        gSettings = this.settings;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(TESSERACT_VIEW);

        await this.app.workspace.getRightLeaf(false).setViewState(
            {
                type: TESSERACT_VIEW,
                active: true,
            },
            { settings: this.settings }
        );

        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(TESSERACT_VIEW)[0]
        );
    }

    async registerCodeBlock() {
        await loadMathJax();
        await finishRenderMath();
        this.registerMarkdownCodeBlockProcessor(
            "Tesseract",
            (source, el, ctx) => {
                // processCodeBlock(source, el, this.settings, ctx);
            }
        );
    }

    async registerPostProcessor() {
        // console.log("registerPostProcessor");
        // await loadMathJax();
        // await finishRenderMath();
        // this.registerMarkdownPostProcessor(getPostPrcessor(this.settings));
    }

    async registerEditorExtensions() {
        // this.registerEditorExtension([resultField, TesseractConfigField]);
    }
}
