/* eslint-disable @typescript-eslint/ban-types */
import { debounce, finishRenderMath, ItemView,  WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";



import { loadMathJax } from "obsidian";
import { TesseractSettings } from "src/Settings";
import { getTesseractSettings } from "src/main";
export const TESSERACT_VIEW = "Tesseract-view";

export const TesseractContext = React.createContext<any>({});



export class TesseractView extends ItemView {
    settings: TesseractSettings;
    root: Root;
    state = {

    };



    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        // this.settings = (this.app as any).plugins.plugins["obsidian-Tesseract"].settings as TesseractSettings;
        this.settings = getTesseractSettings();
        this.state = {

        };
        this.icon = "sigma";
    }

    getViewType() {
        return TESSERACT_VIEW;
    }

    getDisplayText() {
        return "Tesseract";
    }

    override onResize(): void {
        super.onResize();
        this.handleResize();
    }

    handleResize = debounce(() => {
        this.render();
    }, 300);




    render() {

        this.root.render(
            <React.StrictMode>
                <TesseractContext.Provider value={{
                    width: this.contentEl.innerWidth,
                    settings: this.settings
                }}>
                   <div>TODO:</div>
                </TesseractContext.Provider>
            </React.StrictMode>
        );
    }



    async onOpen() {
        const { contentEl } = this;
        // contentEl.setText('Woah!');
        // this.titleEl.setText("Obsidian Janitor")	

        this.root = createRoot(contentEl/*.children[1]*/);
        await loadMathJax();
        await finishRenderMath();
        this.render();
        // const e = nerdamer('x^2+2*(cos(x)+x*x)');
        // const latex = e.toTeX();
        // console.log(latex);
        // const mathEl = renderMath(latex, true);
        // contentEl.appendChild(mathEl);
    }

    async onClose() {

        this.root.unmount();
    }
}
