// --- GITHUB UPDATE BANNER HTML ---
const updateBannerHTML = `
<div id="github-update-banner" style="display: none; background: #0056b3; color: white; padding: 12px; text-align: center; font-family: sans-serif; position: relative; z-index: 10000; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
    🚀 <strong>Update Available!</strong> Version <span id="update-version-text"></span> is out.
    <a id="update-link" href="#" target="_blank" style="color: #fff; text-decoration: underline; margin: 0 20px; font-weight: bold;">View Release Notes & Update</a>
    <button id="update-dismiss-btn" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.5); color: white; padding: 5px 15px; cursor: pointer; border-radius: 4px; font-weight: bold;">Dismiss</button>
</div>
`;

// dismiss for the current session
window.dismissUpdateBanner = function(versionToDismiss) {
    document.getElementById('github-update-banner').style.display = 'none';
    // Save to sessionStorage wipes when closed.
    sessionStorage.setItem('dismissedUpdateVersion', versionToDismiss);
};

// Function to ping the backend and check for updates
async function checkForUpdates() {
    try {
        const res = await fetch(`/api/check_update?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        
        if (data.updateAvailable) {
            // Check the SESSION memory to see if we dismissed it during this active use
            const skippedVersion = sessionStorage.getItem('dismissedUpdateVersion');
            
            if (skippedVersion !== data.latest) {
                const banner = document.getElementById('github-update-banner');
                document.getElementById('update-version-text').innerText = data.latest;
                document.getElementById('update-link').href = data.url;
                
                document.getElementById('update-dismiss-btn').onclick = () => dismissUpdateBanner(data.latest);
                
                banner.style.display = 'block';
            }
        }
    } catch (e) {
        console.error("Failed to check for updates:", e);
    }
}

const boseMassBannerHTML = `
<div id="mass-error-banner">
    <div class="banner-header">
        <span class="banner-title">?? Music Assistant Error</span>
        <button class="banner-close" onclick="dismissMassBanner()">&times;</button>
    </div>
    <div class="banner-body">
        Music Assistant reported a playback failure. How to fix it:
        <ul>
            <li>
                <strong>Invalid Media (Empty album, dead stream):</strong><br>
                No restart needed. <strong>Dismiss</strong> this message. It will clear on next successful playback.
            </li>
            <li>
                <strong>Dropped DLNA Socket:</strong><br>
                The speaker connection dropped. Try a quick <strong>Force Reconnect</strong> first.
            </li>
            <li>
                <strong>Server Locked Up:</strong><br>
                If reconnecting fails, you must do a full <strong>Restart Service</strong>.
            </li>
        </ul>
    </div>
    <div class="banner-actions">
        <button class="btn-dismiss" onclick="dismissMassBanner()">Dismiss</button>
        <button class="btn-reconnect" onclick="triggerAggressiveReconnect()">?? Force Reconnect</button>
        <button class="btn-restart" onclick="restartMassFromBanner(this)">Restart Service</button>
    </div>
</div>
`;

// Inject the banner HTML into the DOM as soon as the page loads
document.addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML('afterbegin', boseMassBannerHTML);
	document.body.insertAdjacentHTML('afterbegin', updateBannerHTML);
    makeBannerDraggable();
    checkForUpdates();
});


window.isMaRestartingProcess = false;

// --- MUSIC ASSISTANT HEALTH MONITOR (Runs every 5 seconds) ---
// This loop constantly checks if the Music Assistant backend is healthy.
setInterval(async () => {
    // STEP 1: Safety Check
    // If a restart or reconnect process is ALREADY happening, skip this check.
    // We don't want to spam the server while it is actively trying to recover.
    if (window.isMaRestartingProcess) return;
    
    try {
        // STEP 2: Ping the Health Endpoint
        // append a timestamp (?t=...) to prevent the browser from caching an old response.
        const res = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
        const h = await res.json();
        const banner = document.getElementById('mass-error-banner');
        
        // STEP 3: Handle Unhealthy State (Connection Lost)
        if (h && h.healthy === false) {
            
            // only proceed if the banner exists on the page, isn't already visible,
            // and hasn't been manually dismissed by the user for this specific error instance.
            if (banner && banner.style.display !== 'flex' && !banner.dataset.dismissed) {
                
                // --- NEW FEATURE: AUTO-RECOVERY INJECTION ---
                // Before showing the error banner, check if the user enabled the "Auto-Reload" preference.
                try {
                    const prefRes = await fetch('/api/admin/settings');
                    const prefs = await prefRes.json();
                    
                    // 'autoRestartMass' is the backend variable tied to our new "Auto-Reload" checkbox.
                    if (prefs.autoRestartMass) {
                        console.log("[UI] Auto-Recovery triggered via user preference.");
                        
                        // Mark the banner as temporarily "dismissed" so this loop doesn't spam trigger
                        // while the auto-recovery is running.
                        banner.dataset.dismissed = "true";
                        
                        // Trigger the aggressive reconnect silently (passing true for 'isAuto')
                        // This function will automatically pause this health loop, and if it fails, 
                        // it will force the banner to pop open on its own.
                        triggerAggressiveReconnect(true);
                        
                        // EXIT the interval early! don't show the manual banner right now.
                        return; 
                    }
                } catch (prefErr) {
                    // If fetching preferences fails, quietly ignore it and fall through to show the banner.
                    console.warn("[UI] Failed to check auto-recovery preference, falling back to manual banner.");
                }
                // --- END NEW FEATURE ---
                
                // ORIGINAL BEHAVIOR: Show the manual error banner if auto-recovery is OFF or failed to trigger.
                banner.style.display = 'flex';
            }
            
        } else {
            // STEP 4: Handle Healthy State (Recovery Successful)
            // If the server reports healthy (true), make sure the banner is hidden.
            if (banner) {
                banner.style.display = 'none';
                
                // Reset the dismissed tracker so the banner can appear again if the server breaks in the future.
                banner.dataset.dismissed = "";
            }
        }
    } catch(e) {
        // Catch network errors silently to prevent console spam if the server goes completely offline.
    }
}, 5000);

function makeBannerDraggable() {
    const banner = document.getElementById('mass-error-banner');
    if (!banner) return;
    const header = banner.querySelector('.banner-header');
    if (!header) return;

    header.style.cursor = 'grab';
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    header.onmousedown = dragMouseDown; header.ontouchstart = dragTouchStart;

    function prepareDrag() {
        if (banner.style.transform !== 'none') {
            const rect = banner.getBoundingClientRect();
            banner.style.transform = 'none';
            banner.style.left = rect.left + 'px'; banner.style.top = rect.top + 'px'; banner.style.margin = '0'; 
        }
        header.style.cursor = 'grabbing';
    }

    function dragMouseDown(e) { e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag; prepareDrag(); }
    function dragTouchStart(e) { const touch = e.touches[0]; pos3 = touch.clientX; pos4 = touch.clientY; document.ontouchend = closeDragElement; document.ontouchmove = elementTouchDrag; prepareDrag(); }
    function elementDrag(e) { e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY; banner.style.top = (banner.offsetTop - pos2) + "px"; banner.style.left = (banner.offsetLeft - pos1) + "px"; }
    function elementTouchDrag(e) { const touch = e.touches[0]; pos1 = pos3 - touch.clientX; pos2 = pos4 - touch.clientY; pos3 = touch.clientX; pos4 = touch.clientY; banner.style.top = (banner.offsetTop - pos2) + "px"; banner.style.left = (banner.offsetLeft - pos1) + "px"; }
    function closeDragElement() { document.onmouseup = null; document.onmousemove = null; document.ontouchend = null; document.ontouchmove = null; header.style.cursor = 'grab'; }
}

async function dismissMassBanner() {
    const banner = document.getElementById('mass-error-banner');
    if(banner) {
        banner.style.display = 'none'; banner.dataset.dismissed = "true";
        banner.style.transform = ''; banner.style.left = ''; banner.style.top = '';
    }
    try { await fetch('/api/health/reset', { method: 'POST' }); } catch (e) { }
}

async function restartMassFromBanner(btn) {
    btn.innerText = "Restarting... (Wait 60s)"; btn.disabled = true; window.isMaRestartingProcess = true;
    await fetch('/api/admin/restart_ma', { method: 'POST' });
    dismissMassBanner();
    setTimeout(() => { btn.innerText = "Restart Service"; btn.disabled = false; window.isMaRestartingProcess = false; }, 60000); 
}

async function triggerAggressiveReconnect() {
    const btn = document.querySelector('#mass-error-banner .btn-reconnect');
    if(btn) { btn.innerText = "? Reconnecting..."; btn.disabled = true; }

    try {
        const res = await fetch('/api/admin/reconnect', { method: 'POST' }); 
        if (res.ok) {
            dismissMassBanner();
        } else {
            alert("? Socket reconnect failed. You may need to use the full Restart Service option.");
        }
    } catch (e) {
        console.error("[UI] Reconnect error:", e);
    } finally {
        if(btn) { btn.innerText = "?? Force Reconnect"; btn.disabled = false; }
    }
}

// --- GLOBAL SYSTEM ACTIONS ---
window.triggerGlobalAllOff = async function() {
    if(!confirm("Turn off ALL speakers?")) return;

    const btns = document.querySelectorAll('.btn-all-off');
    btns.forEach(b => b.style.opacity = '0.5');

    try {
        // 1. Fetch current states to know who is currently ON
        const res = await fetch('/api/status');
        const devices = await res.json();

        // 2. OPTIMISTIC UI (Adapts to current page)
        // -> If user is on control.html
        if (typeof window.isPollingFrozen !== 'undefined') {
            window.isPollingFrozen = true;
        }
        if (window.LockManager && window.currentDevices) {
            window.currentDevices.forEach(d => {
                if (!d.isStandby) window.LockManager.set(d.ip, 'POWER', 'OFF');
            });
        }
        // -> If user is on admin.html
        devices.forEach(d => {
            const pwrBtn = document.getElementById(`pwr-${d.ip}`);
            const modeBadge = document.getElementById(`mode-${d.ip}`);
            if (pwrBtn && !d.isStandby) {
                pwrBtn.className = 'pwr-off'; 
                pwrBtn.innerText = 'OFF';
                if (modeBadge) modeBadge.innerText = '(STANDBY)';
            }
        });

        // 3. FILTER: Command only Masters and Standalone speakers
        const onDevices = devices.filter(d => {
            const isSlave = (d.zone && d.zone.master && d.zone.master !== d.mac);
            return !d.isStandby && !isSlave;
        });

        // 4. Send individual POWER keys
        for (const d of onDevices) {
            await fetch('/api/key', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ ip: d.ip, key: 'POWER' }) 
            });
        }

        // Wait 1.5s for hardware to process (Matches the individual toggle delay)
        await new Promise(r => setTimeout(r, 1500));

        // 5. Unfreeze and Quietly Refresh specific elements
        if (typeof window.isPollingFrozen !== 'undefined') {
            window.isPollingFrozen = false;
        }

        // Quietly fetch individual states instead of nuking the grid with loadAdmin()
        if (typeof window.fetchDeviceState === 'function') {
            devices.forEach(d => window.fetchDeviceState(d.ip));
        } else if (typeof window.loadStatus === 'function') {
            window.loadStatus();
        }
    } catch (e) {
        console.error("Failed to power off speakers", e);
    } finally {
        btns.forEach(b => b.style.opacity = '1');
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // Only execute this fetch if we are actually on the tools.html page
    if (!document.getElementById('pref_autoResume')) return; 
    
    try {
        const res = await fetch('/api/admin/settings');
        const prefs = await res.json();
        document.getElementById('pref_autoResume').checked = prefs.autoResumePreset;
        document.getElementById('pref_autoRestart').checked = prefs.autoRestartMass;
        document.getElementById('pref_autoSync').checked = prefs.autoSyncVolume;
        document.getElementById('pref_autoSort').checked = prefs.autoSortSpeakers;
    } catch(e) { 
        console.error("[UI] Failed to load preferences", e); 
    }
});

async function savePreferences() {
    const payload = {
        autoResumePreset: document.getElementById('pref_autoResume').checked,
        autoRestartMass: document.getElementById('pref_autoRestart').checked,
        autoSyncVolume: document.getElementById('pref_autoSync').checked,
        autoSortSpeakers: document.getElementById('pref_autoSort').checked
    };
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) alert("? Preferences saved successfully.");
    } catch(e) { 
        alert("? Failed to save preferences."); 
    }
}
