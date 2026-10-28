// Módulo "excel" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { materialsFeatureAllowed } from "./access.js";


// A implementação Excel fica fora do grafo inicial e só é baixada ao primeiro uso.
export let excelFeaturePromise;
export function getExcelFeature() {
    excelFeaturePromise ||= import("../features/excel.js");
    return excelFeaturePromise;
}
export async function downloadMaterialsAsExcel(...args) {
    if (!materialsFeatureAllowed) {
        return;
    }
    return (await getExcelFeature()).downloadMaterialsAsExcel(...args);
}
export async function loadAssociationDefinitionsFromExcel(...args) {
    return (await getExcelFeature()).loadAssociationDefinitionsFromExcel(...args);
}
export async function loadAssociaUnitsFromExcel(...args) {
    return (await getExcelFeature()).loadAssociaUnitsFromExcel(...args);
}
