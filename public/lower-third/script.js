(function () {
    var lowerThird = document.getElementById("lowerThird");
    var songTitleEl = document.getElementById("songTitle");
    var singerNameEl = document.getElementById("singerName");
    var inputTitle = document.getElementById("inputTitle");
    var inputSinger = document.getElementById("inputSinger");
    var btnShow = document.getElementById("btnShow");
    var btnHide = document.getElementById("btnHide");

    var AUTO_HIDE_MS = 6000;
    var hideTimer = null;

    function clearHideTimer() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function applyCopyFromInputs() {
        var t = (inputTitle && inputTitle.value.trim()) || "";
        var s = (inputSinger && inputSinger.value.trim()) || "";
        if (songTitleEl) songTitleEl.textContent = t || "—";
        if (singerNameEl) singerNameEl.textContent = s || "—";
    }

    function show() {
        applyCopyFromInputs();
        clearHideTimer();
        lowerThird.setAttribute("data-visible", "true");
        lowerThird.setAttribute("aria-hidden", "false");
        hideTimer = setTimeout(function () {
            hide();
        }, AUTO_HIDE_MS);
    }

    function hide() {
        clearHideTimer();
        lowerThird.setAttribute("data-visible", "false");
        lowerThird.setAttribute("aria-hidden", "true");
    }

    function toggle() {
        if (lowerThird.getAttribute("data-visible") === "true") {
            hide();
        } else {
            show();
        }
    }

    if (btnShow) btnShow.addEventListener("click", show);
    if (btnHide) btnHide.addEventListener("click", hide);

    document.addEventListener("keydown", function (e) {
        if (e.code !== "Space" && e.key !== " ") return;
        var tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) {
            return;
        }
        e.preventDefault();
        toggle();
    });

    // Optional: ?hideControls=1 — hide test panel for clean OBS capture
    if (/[?&]hideControls=1(?:&|$)/.test(window.location.search)) {
        var panel = document.getElementById("controls");
        if (panel) panel.style.display = "none";
    }
})();
