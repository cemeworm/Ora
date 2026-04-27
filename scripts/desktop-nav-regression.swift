#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

private let windowTitleBase = "Ora"
private let windowOwnerName = "ora-desktop"

private struct RegressionStep {
  let label: String
  let expectedTitle: String
  let point: (CGRect) -> CGPoint
}

private let regressionSteps: [RegressionStep] = [
  RegressionStep(
    label: "Agents",
    expectedTitle: "\(windowTitleBase) · Agents",
    point: { bounds in CGPoint(x: bounds.minX + 120, y: bounds.minY + 184) }
  ),
  RegressionStep(
    label: "Skills",
    expectedTitle: "\(windowTitleBase) · Skills",
    point: { bounds in CGPoint(x: bounds.minX + 120, y: bounds.minY + 230) }
  ),
  RegressionStep(
    label: "Modes",
    expectedTitle: "\(windowTitleBase) · Modes",
    point: { bounds in CGPoint(x: bounds.minX + 120, y: bounds.minY + 276) }
  ),
  RegressionStep(
    label: "Evaluation",
    expectedTitle: "\(windowTitleBase) · Evaluation",
    point: { bounds in CGPoint(x: bounds.minX + 120, y: bounds.minY + 322) }
  ),
  RegressionStep(
    label: "Settings",
    expectedTitle: "\(windowTitleBase) · Settings",
    point: { bounds in CGPoint(x: bounds.minX + 120, y: bounds.maxY - 34) }
  ),
]

private func windowList() -> [[String: Any]] {
  guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
    return []
  }
  return windows
}

private func targetWindow() -> (pid: pid_t, bounds: CGRect, title: String)? {
  let candidates = windowList().compactMap { window -> (pid: pid_t, bounds: CGRect, title: String, area: CGFloat)? in
    guard
      let ownerName = window[kCGWindowOwnerName as String] as? String,
      ownerName == windowOwnerName,
      let ownerPid = window[kCGWindowOwnerPID as String] as? Int32,
      let boundsValue = window[kCGWindowBounds as String],
      let bounds = CGRect(dictionaryRepresentation: boundsValue as! CFDictionary),
      bounds.width > 900,
      bounds.height > 600
    else {
      return nil
    }

    let title = (window[kCGWindowName as String] as? String) ?? ""
    guard title.hasPrefix(windowTitleBase) else {
      return nil
    }

    return (pid: ownerPid, bounds: bounds, title: title, area: bounds.width * bounds.height)
  }

  return candidates
    .sorted { $0.area > $1.area }
    .first
    .map { (pid: $0.pid, bounds: $0.bounds, title: $0.title) }
}

private func waitForWindow(timeout: TimeInterval) -> (pid: pid_t, bounds: CGRect, title: String) {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if let window = targetWindow() {
      return window
    }
    Thread.sleep(forTimeInterval: 0.25)
  }

  fputs("Timed out waiting for target/debug/ora-desktop window.\n", stderr)
  exit(1)
}

private func currentTitle() -> String? {
  targetWindow()?.title
}

private func waitForTitle(_ expectedTitle: String, timeout: TimeInterval) {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if currentTitle() == expectedTitle {
      return
    }
    Thread.sleep(forTimeInterval: 0.2)
  }

  let observed = currentTitle() ?? "<missing>"
  fputs("Timed out waiting for title '\(expectedTitle)'. Observed '\(observed)'.\n", stderr)
  exit(1)
}

private func activate(pid: pid_t) {
  NSRunningApplication(processIdentifier: pid)?.activate(options: [])
}

private func mouseEvent(type: CGEventType, point: CGPoint) -> CGEvent {
  let desktopBounds = NSScreen.screens.reduce(into: CGRect.null) { bounds, screen in
    bounds = bounds.union(screen.frame)
  }
  let convertedPoint = CGPoint(x: point.x, y: desktopBounds.maxY - point.y)

  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: convertedPoint, mouseButton: .left) else {
    fatalError("Unable to create mouse event.")
  }
  event.post(tap: .cghidEventTap)
  return event
}

private func click(at point: CGPoint) {
  _ = mouseEvent(type: .mouseMoved, point: point)
  Thread.sleep(forTimeInterval: 0.05)
  _ = mouseEvent(type: .leftMouseDown, point: point)
  Thread.sleep(forTimeInterval: 0.05)
  _ = mouseEvent(type: .leftMouseUp, point: point)
}

let initialWindow = waitForWindow(timeout: 45)
activate(pid: initialWindow.pid)
Thread.sleep(forTimeInterval: 0.5)

print("Attached to pid \(initialWindow.pid) with title '\(initialWindow.title)'.")

for step in regressionSteps {
  let window = waitForWindow(timeout: 10)
  let point = step.point(window.bounds)
  print("Clicking \(step.label) at (\(Int(point.x)), \(Int(point.y)))...")
  click(at: point)
  waitForTitle(step.expectedTitle, timeout: 5)
  print("Verified \(step.expectedTitle)")
}

print("Desktop navigation regression passed.")
