import { DEFAULT_SETTINGS, TesseractSettings } from "src/Settings";
import { addIcon, FileSystemAdapter, MarkdownView, normalizePath } from "obsidian";

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


// https://github.com/naptha/tesseract.js#tesseractjs
// TODO: consider also https://www.npmjs.com/package/node-native-ocr

let gSettings: TesseractSettings;

export function getTesseractSettings() {
    return gSettings;
}


const EMBED_REGEX = /!\[\[(.*\.(?:png|jpg|jpeg|gif|bmp|svg))(?:.*)\]\]/i;

function parseInternalImageLink(line: string){
    const m = EMBED_REGEX.exec(line);
    if(m!==null){
        return m[1];
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

            editorCallback: async (editor, view)=>{
                const cursor  = editor.getCursor();
                //@ts-ignore
                // const token = editor.getClickableTokenAt(cursor);
                // console.log(token);
                // if(token && (token.type === "internal-link" || token.type === "external-link") ) {
                //     //
                // }
                const line = editor.getLine(cursor.line);
                const il = parseInternalImageLink(line);
                if(il){
                    console.log(il);
                    const adapter = this.app.vault.adapter;
                    if(adapter instanceof FileSystemAdapter) {
                        const normalizedPath = normalizePath(il)
                        let fullPath = adapter.getFilePath(normalizedPath) as string | URL
                        console.log(fullPath);
                        if(!(typeof fullPath === "string")){
                            fullPath = fullPath.pathname;
                        }
                        const text = await this.recognize(fullPath);
                        
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

    onunload() {
        this.app.workspace.detachLeavesOfType(TESSERACT_VIEW);
    }

    async recognize(img:string){
        await this.worker.load();
        await this.worker.loadLanguage("eng");
        await this.worker.initialize('eng');
        const {
            data: { text },
        } = await this.worker.recognize(
            img
        );
        console.log(text);
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
