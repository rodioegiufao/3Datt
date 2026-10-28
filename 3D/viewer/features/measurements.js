import {
    AngleMeasurementsPlugin,
    AngleMeasurementsMouseControl,
    DistanceMeasurementsPlugin,
    DistanceMeasurementsMouseControl
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

export function createMeasurementTools({ viewer, PointerLens }) {
    const angleMeasurementsPlugin = new AngleMeasurementsPlugin(viewer, { zIndex: 100000 });
    const angleMeasurementsMouseControl = new AngleMeasurementsMouseControl(angleMeasurementsPlugin, {
        pointerLens: new PointerLens(viewer),
        snapping: true
    });
    const distanceMeasurementsPlugin = new DistanceMeasurementsPlugin(viewer, { zIndex: 100000 });
    const distanceMeasurementsMouseControl = new DistanceMeasurementsMouseControl(distanceMeasurementsPlugin, {
        pointerLens: new PointerLens(viewer),
        snapping: true
    });

    angleMeasurementsMouseControl.deactivate();
    distanceMeasurementsMouseControl.deactivate();
    return {
        angleMeasurementsPlugin,
        angleMeasurementsMouseControl,
        distanceMeasurementsPlugin,
        distanceMeasurementsMouseControl
    };
}