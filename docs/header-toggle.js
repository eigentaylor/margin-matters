// Header toggle wiring moved out of inline HTML so all pages can share it.
(function () {
    function initHeaderToggle(root = document) {
        try {
            const toggle = root.getElementById("headerToggle");
            const nav = root.getElementById("headerNav");
            if (!toggle || !nav) return;
            // avoid attaching multiple listeners if script is evaluated more than once
            if (toggle.__header_toggle_attached) return;
            toggle.addEventListener("click", function () {
                const isExpanded = nav.classList.toggle("expanded");
                toggle.setAttribute("aria-expanded", isExpanded);
                toggle.classList.toggle("active");
            });
            toggle.__header_toggle_attached = true;
        } catch (e) {
            // silent fail; the page may not include header elements
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initHeaderToggle(document); });
    } else {
        // If script is added late, initialize immediately
        initHeaderToggle(document);
    }
})();
