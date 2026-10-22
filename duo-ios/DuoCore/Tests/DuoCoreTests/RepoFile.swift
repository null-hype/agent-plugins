import Foundation

/// Tests read the committed source files in place instead of keeping copies in the package.
func repoFile(_ path: String, from file: String = #filePath) -> URL {
    var url = URL(fileURLWithPath: file)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // DuoCoreTests, Tests, DuoCore, duo-ios, repo root
    return url.appendingPathComponent(path)
}
