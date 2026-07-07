const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    thumbnailSize: 200,
    forceRight: true,
    hideNoImages: false,
    clickToZoom: false,
};

class RenameModal extends obsidian.Modal {
    constructor(app, file, view) {
        super(app);
        this.file = file;
        this.view = view;
    }
    onOpen() {
        const {contentEl} = this;
        contentEl.createEl("h2", {text: `Rename ${this.file.name}`});
        
        const inputContainer = contentEl.createDiv({cls: "gallery-rename-container"});
        inputContainer.style.display = "flex";
        inputContainer.style.flexDirection = "column";
        inputContainer.style.gap = "10px";

        const input = inputContainer.createEl("input", {type: "text", value: this.file.basename});
        input.style.width = "100%";
        
        const btnContainer = inputContainer.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.gap = "10px";

        const cancelBtn = btnContainer.createEl("button", {text: "Cancel"});
        const renameBtn = btnContainer.createEl("button", {text: "Rename", cls: "mod-cta"});

        cancelBtn.onclick = () => this.close();
        renameBtn.onclick = async () => {
            const newName = input.value.trim();
            if (newName && newName !== this.file.basename) {
                const newPath = this.file.parent.path + "/" + newName + "." + this.file.extension;
                await this.app.fileManager.renameFile(this.file, newPath);
                if (this.view) {
                    this.view.renderGallery();
                }
            }
            this.close();
        };

        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                renameBtn.click();
            } else if (e.key === 'Escape') {
                cancelBtn.click();
            }
        });

        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    }
    onClose() {
        this.contentEl.empty();
    }
}

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

        const getVisibleImages = () => {
            const query = searchInput.value.toLowerCase();
            return allFiles.filter(f => {
                const isImg = mediaExtensions.includes(f.extension.toLowerCase());
                if (!isImg) return false;
                return f.name.toLowerCase().includes(query);
            });
        };

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

            itemEl.addEventListener('click', async (e) => {
                if (this.plugin.settings.clickToZoom && isImage) {
                    e.preventDefault();
                    const visibleImages = getVisibleImages();
                    this.openLightbox(file, visibleImages);
                } else {
                    // Open file in Obsidian
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.openFile(file);
                }
            });

            itemEl.addEventListener('contextmenu', (e) => {
                this.showContextMenu(file, e);
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

    showContextMenu(file, e) {
        e.preventDefault();
        const menu = new obsidian.Menu();

        // Open in new tab (at the top)
        menu.addItem((item) => {
            item.setTitle("Open in new tab")
                .setIcon("file-plus")
                .onClick(async () => {
                    const leaf = this.app.workspace.getLeaf('tab');
                    await leaf.openFile(file);
                });
        });

        menu.addSeparator();

        // 1. List of md file names that contain this image
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        let hasBacklinks = false;
        for (const sourcePath in resolvedLinks) {
            if (file.path in resolvedLinks[sourcePath]) {
                const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
                if (sourceFile instanceof obsidian.TFile && sourceFile.extension === 'md') {
                    hasBacklinks = true;
                    menu.addItem((item) => {
                        item.setTitle(`📄 ${sourceFile.basename}`)
                            .setIcon("file-text")
                            .onClick(async () => {
                                const leaf = this.app.workspace.getLeaf(false);
                                await leaf.openFile(sourceFile);
                            });
                    });
                }
            }
        }

        if (hasBacklinks) {
            menu.addSeparator();
        }

        // 2. Copy path submenu
        menu.addItem((item) => {
            item.setTitle("Copy path");
            item.setIcon("link");
            if (typeof item.setSubmenu === "function") {
                const submenu = item.setSubmenu();
                submenu.addItem((subItem) => {
                    subItem.setTitle("as Obsidian URL")
                        .setIcon("link")
                        .onClick(() => {
                            const url = `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
                            navigator.clipboard.writeText(url);
                        });
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle("from vault folder")
                        .setIcon("folder")
                        .onClick(() => {
                            navigator.clipboard.writeText(file.path);
                        });
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle("from system root")
                        .setIcon("hard-drive")
                        .onClick(() => {
                            const adapter = this.app.vault.adapter;
                            const require = window.require;
                            const path = require ? require('path') : null;
                            let fullPath = "";
                            if (path && adapter.getBasePath) {
                                fullPath = path.join(adapter.getBasePath(), file.path);
                            } else {
                                fullPath = adapter.getBasePath ? adapter.getBasePath() + "/" + file.path : file.path;
                            }
                            navigator.clipboard.writeText(fullPath);
                        });
                });
            } else {
                // Fallback for older Obsidian versions
                item.onClick(() => {
                    navigator.clipboard.writeText(file.path);
                });
            }
        });

        menu.addSeparator();

        // 3. System actions
        menu.addItem((item) => {
            item.setTitle("Open in default app")
                .setIcon("arrow-up-right")
                .onClick(() => {
                    this.app.openWithDefaultApp(file.path);
                });
        });

        menu.addItem((item) => {
            item.setTitle("Show in system explorer")
                .setIcon("folder")
                .onClick(() => {
                    this.app.showInFolder(file.path);
                });
        });

        menu.addItem((item) => {
            item.setTitle("Reveal file in navigation")
                .setIcon("compass")
                .onClick(() => {
                    const explorerPlugin = this.app.internalPlugins.getPluginById("file-explorer");
                    if (explorerPlugin && explorerPlugin.instance) {
                        explorerPlugin.instance.revealInFolder(file);
                    }
                });
        });

        menu.addSeparator();

        // 4. Rename & Delete
        menu.addItem((item) => {
            item.setTitle("Rename...")
                .setIcon("pencil")
                .onClick(() => {
                    new RenameModal(this.app, file, this).open();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Delete")
                .setIcon("trash")
                .onClick(async () => {
                    await this.app.vault.trash(file, true);
                    this.renderGallery();
                });
        });

        menu.showAtMouseEvent(e);
    }

    openLightbox(initialFile, visibleImages) {
        let currentIndex = visibleImages.indexOf(initialFile);
        if (currentIndex === -1) return;

        let zoomLevel = 1.0;
        let isDragging = false;
        let startX = 0, startY = 0;
        let translateX = 0, translateY = 0;
        let lastSwitchTime = 0;

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.addClass('gallery-lightbox-overlay');

        // Close button
        const closeBtn = overlay.createEl('div', { cls: 'gallery-lightbox-close', text: '×' });

        // Image container
        const imgContainer = overlay.createDiv('gallery-lightbox-container');
        const imgEl = imgContainer.createEl('img', { cls: 'gallery-lightbox-img' });

        // Thumbnail strip container
        const stripContainer = overlay.createDiv('gallery-lightbox-strip');
        const thumbEls = [];

        visibleImages.forEach((file, index) => {
            const thumbImg = stripContainer.createEl('img', {
                cls: 'gallery-lightbox-strip-item'
            });
            thumbImg.src = this.app.vault.getResourcePath(file);
            thumbImg.addEventListener('click', (e) => {
                e.stopPropagation();
                currentIndex = index;
                updateImage();
            });
            thumbEls.push(thumbImg);
        });

        const updateTransform = () => {
            imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoomLevel})`;
        };

        // Function to update the image in the lightbox
        const updateImage = () => {
            const file = visibleImages[currentIndex];
            imgEl.src = this.app.vault.getResourcePath(file);
            zoomLevel = 1.0;
            translateX = 0;
            translateY = 0;
            updateTransform();
            imgEl.style.cursor = 'zoom-in';

            // Highlight and center active thumbnail
            thumbEls.forEach((thumbEl, idx) => {
                if (idx === currentIndex) {
                    thumbEl.addClass('is-active');
                    setTimeout(() => {
                        thumbEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    }, 50);
                } else {
                    thumbEl.removeClass('is-active');
                }
            });
        };

        const setZoom = (newZoom) => {
            zoomLevel = newZoom;
            if (zoomLevel <= 1.0) {
                zoomLevel = 1.0;
                translateX = 0;
                translateY = 0;
                imgEl.style.cursor = 'zoom-in';
            } else {
                imgEl.style.cursor = 'grab';
            }
            updateTransform();
        };

        // Keyboard navigation
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                currentIndex = (currentIndex - 1 + visibleImages.length) % visibleImages.length;
                updateImage();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                currentIndex = (currentIndex + 1) % visibleImages.length;
                updateImage();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setZoom(Math.min(zoomLevel + 0.15, 5.0));
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setZoom(Math.max(zoomLevel - 0.15, 0.2));
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeLightbox();
            }
        };

        // Mouse wheel navigation
        const handleWheel = (e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - lastSwitchTime < 250) return;

            if (e.deltaY > 0) {
                currentIndex = (currentIndex + 1) % visibleImages.length;
                lastSwitchTime = now;
                updateImage();
            } else if (e.deltaY < 0) {
                currentIndex = (currentIndex - 1 + visibleImages.length) % visibleImages.length;
                lastSwitchTime = now;
                updateImage();
            }
        };

        // Context menu in lightbox
        const handleContextMenu = (e) => {
            const file = visibleImages[currentIndex];
            this.showContextMenu(file, e);
        };

        // Close lightbox
        const closeLightbox = () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            overlay.remove();
        };

        // Drag to pan setup
        const handleMouseDown = (e) => {
            if (e.button !== 0) return; // Left click only
            if (zoomLevel > 1.0) {
                isDragging = true;
                startX = e.clientX - translateX;
                startY = e.clientY - translateY;
                imgEl.style.cursor = 'grabbing';
                e.preventDefault();
            }
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        };

        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                imgEl.style.cursor = 'grab';
            }
        };

        closeBtn.onclick = closeLightbox;
        overlay.onclick = (e) => {
            if (e.target === overlay || e.target === imgContainer) {
                closeLightbox();
            }
        };

        // Attach events
        window.addEventListener('keydown', handleKeyDown);
        overlay.addEventListener('wheel', handleWheel, { passive: false });
        imgEl.addEventListener('contextmenu', handleContextMenu);
        imgEl.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // Also allow right click on container/overlay just in case
        overlay.addEventListener('contextmenu', (e) => {
            if (e.target === overlay || e.target === imgContainer) {
                handleContextMenu(e);
            }
        });

        document.body.appendChild(overlay);
        updateImage();
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

        new obsidian.Setting(containerEl)
            .setName('Hide Icon in Folders Without Images')
            .setDesc('Hide the gallery icon in the file explorer for folders that do not directly contain any images or videos.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideNoImages)
                .onChange(async (value) => {
                    this.plugin.settings.hideNoImages = value;
                    await this.plugin.saveSettings();
                    this.plugin.removeGalleryIcons();
                    this.plugin.injectGalleryIcons();
                }));

        new obsidian.Setting(containerEl)
            .setName('Click to Zoom Image')
            .setDesc('Clicking on an image in the gallery will open a zoomable focus preview overlay instead of opening the file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.clickToZoom)
                .onChange(async (value) => {
                    this.plugin.settings.clickToZoom = value;
                    await this.plugin.saveSettings();
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

        this.registerEvent(this.app.vault.on('create', () => {
            this.injectGalleryIcons();
        }));
        this.registerEvent(this.app.vault.on('delete', () => {
            this.injectGalleryIcons();
        }));
        this.registerEvent(this.app.vault.on('rename', () => {
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
        // Obsidian handles unknown view types natively, detaching here causes settings tab to crash
        // this.app.workspace.detachLeavesOfType("gallery-view");
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

    folderHasImages(folderPath) {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !(folder instanceof obsidian.TFolder)) return false;
        
        const mediaExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
        const videoExtensions = ['mp4', 'webm', 'mov'];
        
        return folder.children.some(child => {
            if (child instanceof obsidian.TFile) {
                const ext = child.extension.toLowerCase();
                return mediaExtensions.includes(ext) || videoExtensions.includes(ext);
            }
            return false;
        });
    }

    injectGalleryIcons() {
        // Use direct DOM query to be completely robust and independent of internal API loading states
        const folderTitles = document.querySelectorAll('.nav-folder-title');
        folderTitles.forEach(titleEl => {
            const folderPath = titleEl.getAttribute('data-path');
            // Root folder might be '/' or empty, we usually want actual folders
            if (!folderPath || folderPath === '/') return;

            const hasImages = !this.settings.hideNoImages || this.folderHasImages(folderPath);
            const existingIcon = titleEl.querySelector('.folder-gallery-icon');

            if (!hasImages) {
                if (existingIcon) {
                    existingIcon.remove();
                }
                return;
            }

            // Skip if already added
            if (existingIcon) return;

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
