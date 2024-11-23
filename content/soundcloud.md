---
title: "SoundCloud"
date: 2024-11-23
---

Some content here...

<div id="app" style="height: 100vh">
  <!-- Webamp will attempt to center itself within this div -->
</div>

<button id="loadWebamp" onclick="initWebamp()">Launch Webamp Player</button>

<script src="https://unpkg.com/webamp@1.5.0/built/webamp.bundle.min.js"></script>
<script src="https://unpkg.com/butterchurn@2.6.7/lib/butterchurn.min.js"></script>
<script src="https://unpkg.com/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js"></script>

<script>
    async function initWebamp() {
        const Webamp = window.Webamp;
        const webamp = new Webamp({
            initialTracks: [{
                metaData: {
                    artist: "Robot Monster",
                    title: "Godzilla 313",
                },
                url: "https://filehost.s3.nl-ams.scw.cloud/mix/Robot%20Monster%20-%20Godzilla%20313.mp3",
                duration: 3529,
            }],
            __butterchurnOptions: {
                importButterchurn: () => Promise.resolve(window.butterchurn),
                getPresets: () => {
                    const presets = window.butterchurnPresets.getPresets();
                    return Object.keys(presets).map((name) => {
                        return {
                            name,
                            butterchurnPresetObject: presets[name],
                        };
                    });
                },
                butterchurnOpen: true,
            },
            windowLayout: {
                main: { position: { top: 0, left: 0 } },
                equalizer: { position: { top: 116, left: 0 } },
                playlist: {
                    position: { top: 232, left: 0 },
                    size: { extraWidth: 0, extraHeight: 4 },
                },
                milkdrop: {
                    position: { top: 0, left: 275 },
                    size: { extraHeight: 12, extraWidth: 7 },
                },
            },
        });

        // Remove any existing Webamp instances
        const oldWebamp = document.querySelector('#webamp');
        if (oldWebamp) {
            oldWebamp.remove();
        }

        await webamp.renderWhenReady(document.getElementById('app'));
    }
</script>

<style>
#app {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99999;
    pointer-events: none;
}

#app > div {
    pointer-events: auto;
}

#loadWebamp {
    padding: 10px 20px;
    background: #f0f0f0;
    border: 1px solid #ccc;
    cursor: pointer;
    margin: 10px 0;
}

#loadWebamp:hover {
    background: #e0e0e0;
}
</style>

