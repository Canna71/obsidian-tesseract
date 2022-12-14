import { DEFAULT_SETTINGS, TesseractSettings } from "src/Settings";
import {
    addIcon,
    CachedMetadata,
    MarkdownPostProcessorContext,
    MarkdownView,
    Menu,
    MenuItem,
    Notice,
    PluginManifest,
    TFile,
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
import { OCRProcessor, parseInternalImageLink, replaceInternalImageLink } from "./Processor";

const sigma = `<path stroke="currentColor" fill="none" d="M78.6067 22.8905L78.6067 7.71171L17.8914 7.71171L48.2491 48.1886L17.8914 88.6654L78.6067 88.6654L78.6067 73.4866" opacity="1"  stroke-linecap="round" stroke-linejoin="round" stroke-width="6" />
`;


// https://github.com/naptha/tesseract.js#tesseractjs
// TODO: consider also https://www.npmjs.com/package/node-native-ocr

let gSettings: TesseractSettings;

export function getTesseractSettings() {
    return gSettings;
}



export default class TesseractPlugin extends Plugin {
    settings: TesseractSettings;
    worker: Worker;
    basePath: string;
    processor: OCRProcessor;

    /**
     *
     */
    constructor(app:App, manifest: PluginManifest) {
        super(app, manifest);
        this.onMetadataChange = this.onMetadataChange.bind(this);
        
    }

    async onload() {
        await this.loadSettings();

        this.registerView(TESSERACT_VIEW, (leaf) => new TesseractView(leaf));

        addIcon("sigma", sigma);

        this.processor = new OCRProcessor(this);

       

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
                this.processor.processEditor(editor);
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

        this.app.metadataCache.on("resolved",( )=>{
            console.log("index finished");
        })
        this.app.metadataCache.on("changed",this.onMetadataChange);

        // this.app.workspace.on("editor-menu",(menu,editor,view)=>{
        //     console.log("editor-menu", menu);
        // })

        // this.app.workspace.on("file-menu",(menu,editor,view)=>{
        //     console.log("file-menu",menu);
        // })

        this.addSettingTab(new TesseractSettingsTab(this.app, this));
    }

    async onMetadataChange(file: TFile,data: string, cache: CachedMetadata){
        console.log("Metadata Changed");

        if(cache.embeds || cache.links){
            await this.scanFile(file,data,cache);
        }
    }

    async scanFile(file: TFile, data: string, cache: CachedMetadata) {
        cache.embeds?.reverse().forEach(async embed=>{
            // const url = embed.link;
            const extension = OCRProcessor.isImage(embed.link);
            if(!extension) return;
            console.log("found embed:", embed.original);
            const newEmbed = await this.processor.processEmbed(embed.original);
            if(newEmbed !== embed.original) {
                const leaf = this.app.workspace.getLeavesOfType("markdown").find(leaf => file === (leaf.view as MarkdownView).file)

                if(leaf){
                    console.log("file is open")
                    const editor = (leaf.view as MarkdownView).editor;
                    editor.replaceRange(newEmbed,
                        {
                            line: embed.position.start.line,
                            ch: embed.position.start.col
                        }
                        , {
                            line: embed.position.end.line,
                            ch: embed.position.end.col
                        });
                } else {
                    console.log("file is not open")

                    const newContent = data.substring(0,embed.position.start.offset)
                    + newEmbed
                    + data.substring(embed.position.end.offset);
                    this.app.vault.modify(file,newContent);
                }
                


                // TODO: here the content of the file might have changed!
                // check if it's open?
                // debounce the scan?
                // this.app.vault.modify(file,newContent);
            }
        })
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(TESSERACT_VIEW);
        this.app.metadataCache.off("changed",this.onMetadataChange);

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

        this.registerMarkdownPostProcessor((el:HTMLElement,ctx:MarkdownPostProcessorContext)=>{
            console.log(el);
            // const internalEmbeds = el.querySelectorAll("span.internal-embed")
            // console.log(internalEmbeds);
            // internalEmbeds.forEach(ie=>console.log(ie.innerHTML));
            this.registerContextMenu(el);
        });
    }

    private registerContextMenu(el: HTMLElement) {
        el.querySelectorAll("img, span.internal-embed").forEach(img => {
            if (img) {
                console.log(img.outerHTML);
                img.addEventListener("contextmenu", (ev: MouseEvent) => {
                    const menu = new Menu();
                    menu.addItem((item: MenuItem) => {
                        item.setIcon("image-file")
                            .setTitle("Copy text content to clipboard")
                            .onClick(async () => {
                                const src = img.getAttr("src");
                                if(src){
                                    const text = await this.processor.recognizeURL(src); 
                                    if(text && text.length){
                                        navigator.clipboard.writeText(text);
                                        new Notice("Text copied to clipboard")
                                        return;
                                    }
                                } 
                                new Notice("No text found")
                                
                            });
                    });
                    menu.showAtPosition({ x: ev.pageX, y: ev.pageY });
                });
                // img.oncontextmenu = (ev=>{
                //     //
                //     console.log(ev);
                // });
            }
        });
    }

    async registerEditorExtensions() {
        // this.registerEditorExtension([resultField, TesseractConfigField]);
    }
}
