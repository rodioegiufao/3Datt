const PROFILE_PERMISSIONS = Object.freeze({
    admin: Object.freeze({ collision: true, materials: true, transform: true }),
    colaborador: Object.freeze({ collision: true, materials: true, transform: true }),
    cliente: Object.freeze({ collision: false, materials: false, transform: false })
});

export const ALL_EXPLORER_TABS = Object.freeze(["models", "objects", "classes", "storeys", "networks", "parts"]);
export const RESTRICTED_EXPLORER_TABS = Object.freeze(["models", "storeys", "networks"]);
const PROFILE_EXPLORER_TABS = Object.freeze({
    admin: ALL_EXPLORER_TABS,
    colaborador: ALL_EXPLORER_TABS,
    cliente: RESTRICTED_EXPLORER_TABS
});

export function getViewerPermissions(user) {
    const profile = typeof user?.perfil === "string" ? user.perfil.trim().toLowerCase() : "";
    const permissions = PROFILE_PERMISSIONS[profile];
    return {
        canUseCollision: Boolean(permissions?.collision),
        canUseMaterials: Boolean(permissions?.materials),
        canTransformModels: Boolean(permissions?.transform),
        canGenerateQuadro: profile === "admin" || profile === "colaborador",
        canUseCoverage: profile === "admin" || profile === "colaborador",
        canReplaceModels: profile === "admin" || profile === "colaborador",
        explorerTabs: [...(PROFILE_EXPLORER_TABS[profile] || RESTRICTED_EXPLORER_TABS)]
    };
}

export function isKnownViewerProfile(user) {
    return Object.hasOwn(PROFILE_PERMISSIONS, user?.perfil);
}
