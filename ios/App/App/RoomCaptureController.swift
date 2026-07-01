import Foundation
import UIKit

#if canImport(RoomPlan)
import RoomPlan

/// Full-screen host for Apple's `RoomCaptureView` — issue #863, PRD #859 S11.
///
/// Runs one RoomPlan session, lets the user finish or cancel, then hands the
/// post-processed `CapturedRoom` back to `RoomPlanCapturePlugin` as JSON plus a
/// USDZ mesh written to local storage. This is the native capture UI only; the
/// review/correct flow on the parametric Sketch is a separate slice (ADR 0025).
@available(iOS 16.0, *)
final class RoomCaptureController: UIViewController, RoomCaptureViewDelegate {
    /// What one successful scan yields back to the plugin.
    struct ScanPayload {
        /// The serialized `CapturedRoom` (RoomPlan's `Codable` output).
        let capturedRoomJson: String
        /// `file://` URI of the exported USDZ in the app's Documents dir.
        let meshUri: String
    }

    enum ScanError: LocalizedError {
        case cancelled
        case export(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "Room scan cancelled"
            case .export(let message): return message
            }
        }
    }

    private let completion: (Result<ScanPayload, Error>) -> Void
    /// Guards against the delegate firing more than once (finish is terminal).
    private var didFinish = false

    private lazy var roomCaptureView: RoomCaptureView = {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = self
        return view
    }()

    private let sessionConfig = RoomCaptureSession.Configuration()

    init(completion: @escaping (Result<ScanPayload, Error>) -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        view = roomCaptureView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(doneTapped))
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped))
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        roomCaptureView.captureSession.run(configuration: sessionConfig)
    }

    /// Done stops the session; RoomPlan then post-processes and delivers the
    /// final `CapturedRoom` via `captureView(didPresent:error:)`.
    @objc private func doneTapped() {
        roomCaptureView.captureSession.stop()
    }

    @objc private func cancelTapped() {
        roomCaptureView.captureSession.stop()
        finish(.failure(ScanError.cancelled))
    }

    // MARK: RoomCaptureViewDelegate

    /// Return true so RoomPlan runs its post-processing pass after `stop()`.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        return true
    }

    /// The final, post-processed room (or an error).
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error = error {
            finish(.failure(error))
            return
        }
        do {
            let encoded = try JSONEncoder().encode(processedResult)
            let json = String(decoding: encoded, as: UTF8.self)
            let meshUri = try exportMesh(processedResult)
            finish(.success(ScanPayload(capturedRoomJson: json, meshUri: meshUri)))
        } catch {
            finish(.failure(ScanError.export(error.localizedDescription)))
        }
    }

    // MARK: Mesh export

    /// Writes the captured USDZ to `Documents/room-scans/<uuid>.usdz` and
    /// returns its file URI. Local-first mirrors how Photos cache blobs on
    /// device before the upload queue syncs them; uploading the mesh to
    /// Supabase and attaching it to the Sketch is a later slice.
    private func exportMesh(_ room: CapturedRoom) throws -> String {
        let documents = try FileManager.default.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = documents.appendingPathComponent("room-scans", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("\(UUID().uuidString).usdz")
        try room.export(to: fileURL)
        return fileURL.absoluteString
    }

    private func finish(_ result: Result<ScanPayload, Error>) {
        guard !didFinish else { return }
        didFinish = true
        completion(result)
        dismiss(animated: true)
    }
}
#endif
