const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    thumbnailSize: 200,
    forceRight: true,
};

class GalleryView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.folderPath = null;
    }

    getViewType() {
        return "gallery-view";
    }

    getDisplayText() {
        if (this.folderPath) {
            return this.folderPath.replace(/\//g, ' > ');
        }
        return "Gallery";
    }

    getIcon() {
        return "image";
    }

    async setState(state, result) {
        if (state && state.folderPath) {
            this.folderPath = state.folderPath;
            await this.renderGallery();
        }
        return super.setState(state, result);
    }

    getState() {
        return { folderPath: this.folderPath };
    }

    async setFolder(folderPath) {
        this.folderPath = folderPath;
        await this.renderGallery();
        // Force leaf to update its display text if changed manually
        if (this.leaf && this.leaf.updateHeader) {
            this.leaf.updateHeader();
        }
    }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("gallery-view-content-container");
        if (this.folderPath) {
            await this.renderGallery();
        } else {
            this.contentEl.createEl("div", {
                text: "No folder selected. Click the gallery icon on a folder in the file explorer.",
                cls: "gallery-empty-state"
            });
        }
    }

    async onClose() {
        // Cleanup if needed
    }

    async renderGallery() {
        if (!this.contentEl) return;
        this.contentEl.empty();

        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!folder || !(folder instanceof obsidian.TFolder)) {
            this.contentEl.createEl("div", {
                text: "Folder not found.",
                cls: "gallery-empty-state"
            });
            return;
        }

        // Search Bar container (sticky at the top)
        const searchContainer = this.contentEl.createDiv("gallery-search-container");
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Filter files by name...",
            cls: "gallery-search-input"
        });

        // Filter all files, not just media
        const allFiles = folder.children.filter(file => file instanceof obsidian.TFile);

        if (allFiles.length === 0) {
            this.contentEl.createEl("div", {
                text: "No files found in this folder.",
                cls: "gallery-empty-state"
            });
            return;
        }

        const gridEl = this.contentEl.createDiv("gallery-view-container");
        gridEl.style.setProperty('--thumb-size', `${this.plugin.settings.thumbnailSize}px`);

        const mediaExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
        const videoExtensions = ['mp4', 'webm', 'mov'];

        for (const file of allFiles) {
            const itemEl = gridEl.createDiv("gallery-item");
            itemEl.setAttribute("data-filename", file.name.toLowerCase());
            
            const ext = file.extension.toLowerCase();
            const isImage = mediaExtensions.includes(ext);
            const isVideo = videoExtensions.includes(ext);
            
            // Get local path for rendering
            const resourcePath = this.app.vault.getResourcePath(file);

            if (isVideo) {
                const videoEl = itemEl.createEl('video');
                videoEl.src = resourcePath;
                videoEl.controls = false;
                videoEl.muted = true;
                // Add hover to play preview
                itemEl.addEventListener('mouseenter', () => videoEl.play().catch(() => {}));
                itemEl.addEventListener('mouseleave', () => {
                    videoEl.pause();
                    videoEl.currentTime = 0;
                });
            } else if (isImage) {
                const imgEl = itemEl.createEl('img');
                imgEl.src = resourcePath;
                imgEl.loading = "lazy";
            } else if (ext === 'md') {
                // Asynchronously load and render the markdown
                this.app.vault.cachedRead(file).then(content => {
                    // Try to find the first image in the markdown
                    // Matches ![[image.png]] or ![[image.png|100]]
                    const wikiMatch = content.match(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))(?:\|[^\]]*)?\]\]/i);
                    // Matches ![alt](image.png) or ![alt](image.png "title") or external urls
                    const mdMatch = content.match(/!\[[^\]]*\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))[^\)]*\)/i);
                    
                    let imagePath = null;
                    if (wikiMatch && wikiMatch[1]) {
                        imagePath = wikiMatch[1];
                    } else if (mdMatch && mdMatch[1]) {
                        imagePath = mdMatch[1];
                    }

                    let resourcePath = null;

                    if (imagePath) {
                        try {
                            // Decode URI components (e.g. %20 to space) for metadataCache
                            imagePath = decodeURIComponent(imagePath);
                        } catch (e) {
                            // Ignore decoding errors if the path is weird
                        }

                        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                            // External image URL
                            resourcePath = imagePath;
                        } else {
                            // Local image file
                            // Resolve the link relative to the current file
                            const imgFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, file.path);
                            if (imgFile instanceof obsidian.TFile) {
                                resourcePath = this.app.vault.getResourcePath(imgFile);
                            }
                        }
                    }

                    if (resourcePath) {
                        // Render image thumbnail for the note
                        const imgEl = itemEl.createEl('img');
                        imgEl.src = resourcePath;
                        imgEl.loading = "lazy";
                        
                        // Add a small badge to indicate it's a note
                        const badgeEl = itemEl.createDiv('gallery-item-badge');
                        badgeEl.setText('MD');
                    } else {
                        // Render text preview if no valid image found
                        const mdContainer = itemEl.createDiv('gallery-item-md-preview');
                        // Render a truncated version to save performance and fit the box
                        const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
                        obsidian.MarkdownRenderer.renderMarkdown(truncatedContent, mdContainer, file.path, this);
                    }
                });
            } else {
                // Placeholder for non-media files
                const placeholderEl = itemEl.createDiv('gallery-item-placeholder');
                placeholderEl.createDiv({ text: ext.toUpperCase(), cls: "gallery-placeholder-ext" });
            }

            const nameEl = itemEl.createDiv("gallery-item-name");
            nameEl.setText(file.name);

            itemEl.addEventListener('click', async () => {
                // Open file in Obsidian
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
            });
        }

        // Setup filter logic
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase();
            const items = gridEl.querySelectorAll(".gallery-item");
            items.forEach(item => {
                const filename = item.getAttribute("data-filename");
                if (filename.includes(query)) {
                    item.style.display = "flex";
                } else {
                    item.style.display = "none";
                }
            });
        });
    }
}

class FolderAsGallerySettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const {containerEl} = this;
        containerEl.empty();

        new obsidian.Setting(containerEl)
            .setName('Thumbnail Size (px)')
            .setDesc('Set the standard thumbnail size for the gallery grid.')
            .addSlider(slider => slider
                .setLimits(100, 500, 10)
                .setValue(this.plugin.settings.thumbnailSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.thumbnailSize = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateGalleryViews();
                }));

        new obsidian.Setting(containerEl)
            .setName('Force Icon to Far Right')
            .setDesc('Enable this if the gallery icon is not the rightmost item (e.g. conflicts with other plugins).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.forceRight)
                .onChange(async (value) => {
                    this.plugin.settings.forceRight = value;
                    await this.plugin.saveSettings();
                    // Re-inject to apply the class
                    this.plugin.removeGalleryIcons();
                    this.plugin.injectGalleryIcons();
                }));
    }
}

class FolderAsGalleryPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.registerView(
            "gallery-view",
            (leaf) => new GalleryView(leaf, this)
        );

        this.addSettingTab(new FolderAsGallerySettingTab(this.app, this));

        // Inject icon when layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.injectGalleryIcons();
        });

        // Re-inject on file explorer updates (like folder open/close)
        // file-explorer is not a documented event, but we can use layout-change or just observe
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.injectGalleryIcons();
        }));

        // Use a mutation observer as a fallback to catch folder expansions
        this.setupMutationObserver();
    }

    onunload() {
        this.removeGalleryIcons();
        if (this.observer) {
            this.observer.disconnect();
        }
        // Safely close any open gallery views to prevent Obsidian from crashing
        this.app.workspace.detachLeavesOfType("gallery-view");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    updateGalleryViews() {
        const leaves = this.app.workspace.getLeavesOfType("gallery-view");
        for (const leaf of leaves) {
            if (leaf.view instanceof GalleryView) {
                leaf.view.renderGallery();
            }
        }
    }

    injectGalleryIcons() {
        // Use direct DOM query to be completely robust and independent of internal API loading states
        const folderTitles = document.querySelectorAll('.nav-folder-title');
        folderTitles.forEach(titleEl => {
            // Skip if already added
            if (titleEl.querySelector('.folder-gallery-icon')) return;

            const folderPath = titleEl.getAttribute('data-path');
            // Root folder might be '/' or empty, we usually want actual folders
            if (!folderPath || folderPath === '/') return;

            const iconEl = document.createElement('div');
            iconEl.addClass('folder-gallery-icon');
            if (this.settings.forceRight) {
                iconEl.addClass('force-right');
            }
            iconEl.setAttribute('aria-label', 'Open as Gallery');
            obsidian.setIcon(iconEl, 'image');

            iconEl.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent folder from expanding/collapsing
                e.preventDefault();
                this.openGalleryForFolder(folderPath);
            });

            titleEl.appendChild(iconEl);
        });
    }

    removeGalleryIcons() {
        const icons = document.querySelectorAll('.folder-gallery-icon');
        icons.forEach(icon => icon.remove());
    }

    setupMutationObserver() {
        // Watch for changes in the workspace to re-inject icons when folders expand
        this.observer = new MutationObserver((mutations) => {
            let shouldInject = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    // Check if added nodes contain nav-folder
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (node.classList?.contains('nav-folder') || node.classList?.contains('nav-folder-children'))) {
                            shouldInject = true;
                            break;
                        }
                    }
                }
                if (shouldInject) break;
            }

            if (shouldInject) {
                this.injectGalleryIcons();
            }
        });

        const workspaceRoot = document.body;
        this.observer.observe(workspaceRoot, { childList: true, subtree: true });
    }

    async openGalleryForFolder(folderPath) {
        const { workspace } = this.app;

        let leaf = workspace.getLeaf('tab'); // Open in new tab
        await leaf.setViewState({
            type: "gallery-view",
            active: true,
            state: { folderPath: folderPath }
        });
    }
}

module.exports = FolderAsGalleryPlugin;
