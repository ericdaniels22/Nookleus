import Capacitor
import Foundation
import UIKit

#if canImport(RoomPlan)
import RoomPlan
#endif

/// `RoomPlanCapture` Capacitor plugin — issue #863, PRD #859 slice S11.
///
/// Wraps Apple **RoomPlan** (iOS 16+, LiDAR devices — iPad Pro / iPhone Pro) so
/// the Capacitor web app can capture a room's geometry into the Sketch. Per
/// [ADR 0025] a scan is an *input* to the parametric Sketch, not a parallel
/// artifact: this plugin returns the `CapturedRoom` payload as JSON and writes
/// the USDZ mesh to local device storage (parallel to how Photos cache blobs
/// locally before the upload queue syncs them), returning a `meshUri`. Mapping
/// the payload onto the Sketch's Room model is a later, separate slice.
///
/// Follows the same custom-plugin pattern as `EmailWidgetBridgePlugin`:
/// Capacitor 8 does NOT auto-discover this class. Compiling it into the `App`
/// target is necessary but not sufficient — the instance is registered manually
/// in `MainViewController.capacitorDidLoad()`. See `RoomPlanCapture-SETUP.md`.
@objc(RoomPlanCapturePlugin)
public class RoomPlanCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomPlanCapturePlugin"
    public let jsName = "RoomPlanCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanRoom", returnType: CAPPluginReturnPromise),
    ]

    /// Whether RoomPlan can run on this device. RoomPlan needs iOS 16+ and a
    /// LiDAR sensor; `RoomCaptureSession.isSupported` is Apple's own gate, and
    /// the app hides the scan affordance wherever this is false (older iPads,
    /// phones, the web/desktop shell), falling back to hand-drawing the Sketch.
    static var roomPlanSupported: Bool {
        #if canImport(RoomPlan)
        if #available(iOS 16.0, *) {
            return RoomCaptureSession.isSupported
        }
        #endif
        return false
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": Self.roomPlanSupported])
    }

    /// Launches the RoomPlan capture UI. Resolves with the serialized
    /// `CapturedRoom` (`capturedRoomJson`) and a `meshUri` file reference to the
    /// exported USDZ; rejects if unsupported, cancelled, or export fails.
    @objc func scanRoom(_ call: CAPPluginCall) {
        #if canImport(RoomPlan)
        if #available(iOS 16.0, *) {
            guard RoomCaptureSession.isSupported else {
                call.reject("RoomPlan is not supported on this device")
                return
            }
            DispatchQueue.main.async {
                guard let presenter = self.bridge?.viewController else {
                    call.reject("No view controller available to present the room scanner")
                    return
                }
                let controller = RoomCaptureController { result in
                    switch result {
                    case .success(let payload):
                        call.resolve([
                            "capturedRoomJson": payload.capturedRoomJson,
                            "meshUri": payload.meshUri,
                        ])
                    case .failure(let error):
                        call.reject(error.localizedDescription)
                    }
                }
                let nav = UINavigationController(rootViewController: controller)
                nav.modalPresentationStyle = .fullScreen
                presenter.present(nav, animated: true)
            }
            return
        }
        #endif
        call.reject("RoomPlan requires iOS 16 or later")
    }
}
