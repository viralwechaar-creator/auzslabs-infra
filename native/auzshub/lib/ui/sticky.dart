import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

/// The website's stacked sheets: every sheet pins near the top once it reaches it (each one a little lower than the one before, so the
/// edge of the sheet behind peeks out) and the next sheet slides up over it. This is CSS `position: sticky` with
/// `top: pin + min(0, viewport - height)` inside one container, drawn as a single scroll child: the sheets lie one after the other,
/// and while painting each pinned sheet is moved down to its pin. Nothing is rebuilt while scrolling, only painted again.
class StickyParentData extends ContainerBoxParentData<RenderBox> {
  /// Negative top margin (the sheet overlaps the one above).
  double mt = 0;
  /// A sheet that pins; the others (the footer) just scroll and cover everything.
  bool sticky = true;
  /// Where the child was painted last (inside the stack), also used for taps.
  double dy = 0;
}

class StickyChild extends ParentDataWidget<StickyParentData> {
  const StickyChild({required this.mt, required this.sticky, required super.child, super.key});
  final double mt;
  final bool sticky;
  @override
  void applyParentData(RenderObject renderObject) {
    final pd = renderObject.parentData as StickyParentData;
    var relayout = false;
    if (pd.mt != mt) {
      pd.mt = mt;
      relayout = true;
    }
    if (pd.sticky != sticky) {
      pd.sticky = sticky;
      relayout = true;
    }
    if (relayout) renderObject.parent?.markNeedsLayout();
  }

  @override
  Type get debugTypicalAncestorWidgetClass => StickySheets;
}

class StickySheets extends MultiChildRenderObjectWidget {
  const StickySheets({required this.repaint, required this.pinBase, required this.step, required this.minH, required super.children, super.key});
  /// Fires whenever the page scrolls (the scroll controller).
  final Listenable repaint;
  /// Where the second sheet pins (design pixels from the top of the screen); each later one pins [step] lower.
  final double pinBase;
  final double step;
  /// Every pinned sheet is at least this tall (the website gives each sheet a full screen).
  final double minH;
  @override
  RenderObject createRenderObject(BuildContext context) => RenderStickySheets(repaint, pinBase, step, minH);
  @override
  void updateRenderObject(BuildContext context, covariant RenderStickySheets r) {
    r
      ..repaint = repaint
      ..pinBase = pinBase
      ..step = step
      ..minH = minH;
  }
}

class RenderStickySheets extends RenderBox with ContainerRenderObjectMixin<RenderBox, StickyParentData>, RenderBoxContainerDefaultsMixin<RenderBox, StickyParentData> {
  RenderStickySheets(this._repaint, this._pinBase, this._step, this._minH);
  Listenable _repaint;
  double _pinBase, _step, _minH;

  set repaint(Listenable v) {
    if (identical(v, _repaint)) return;
    if (attached) _repaint.removeListener(markNeedsPaint);
    _repaint = v;
    if (attached) _repaint.addListener(markNeedsPaint);
  }

  set pinBase(double v) {
    if (v != _pinBase) {
      _pinBase = v;
      markNeedsPaint();
    }
  }

  set step(double v) {
    if (v != _step) {
      _step = v;
      markNeedsPaint();
    }
  }

  set minH(double v) {
    if (v != _minH) {
      _minH = v;
      markNeedsLayout();
    }
  }

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _repaint.addListener(markNeedsPaint);
  }

  @override
  void detach() {
    _repaint.removeListener(markNeedsPaint);
    super.detach();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! StickyParentData) child.parentData = StickyParentData();
  }

  @override
  void performLayout() {
    final w = constraints.maxWidth;
    var y = 0.0;
    var child = firstChild;
    while (child != null) {
      final pd = child.parentData! as StickyParentData;
      y += pd.mt;
      child.layout(BoxConstraints(minWidth: w, maxWidth: w, minHeight: pd.sticky ? _minH : 0), parentUsesSize: true);
      pd.offset = Offset(0, y);
      pd.dy = y;
      y += child.size.height;
      child = pd.nextSibling;
    }
    size = constraints.constrain(Size(w, y));
  }

  @override
  double computeMinIntrinsicHeight(double width) => 0;
  @override
  double computeMaxIntrinsicHeight(double width) => 0;

  @override
  Size computeDryLayout(BoxConstraints constraints) => Size(constraints.maxWidth, 0);

  /// Where each pinned sheet sits for the current scroll position.
  void _place() {
    var scale = 1.0, stackTop = 0.0, vh = double.infinity;
    final vp = RenderAbstractViewport.maybeOf(this) as RenderBox?;
    if (vp != null && vp.hasSize) {
      final m = getTransformTo(vp);
      scale = m.getMaxScaleOnAxis();
      if (scale <= 0) scale = 1;
      stackTop = MatrixUtils.transformPoint(m, Offset.zero).dy / scale;
      vh = vp.size.height / scale;
    }
    // the container ends where the last pinned sheet ends
    double? contBottom;
    for (var c = firstChild; c != null; c = (c.parentData! as StickyParentData).nextSibling) {
      final pd = c.parentData! as StickyParentData;
      if (pd.sticky) contBottom = pd.offset.dy + c.size.height;
    }
    var j = 0;
    for (var c = firstChild; c != null; c = (c.parentData! as StickyParentData).nextSibling) {
      final pd = c.parentData! as StickyParentData;
      if (!pd.sticky || contBottom == null) {
        pd.dy = pd.offset.dy;
        continue;
      }
      final h = c.size.height;
      final pin = (j == 0 ? 0.0 : _pinBase + _step * (j - 1)) + math.min(0.0, vh - h);
      j++;
      final y = pd.offset.dy;
      final desired = math.max(y, pin - stackTop);
      final maxTop = math.max(y, contBottom - h);
      pd.dy = math.min(desired, maxTop);
    }
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    _place();
    for (var c = firstChild; c != null; c = (c.parentData! as StickyParentData).nextSibling) {
      final pd = c.parentData! as StickyParentData;
      context.paintChild(c, offset + Offset(0, pd.dy));
    }
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    var child = lastChild;
    while (child != null) {
      final pd = child.parentData! as StickyParentData;
      final hit = result.addWithPaintOffset(offset: Offset(0, pd.dy), position: position, hitTest: (r, p) => child!.hitTest(r, position: p));
      if (hit) return true;
      child = pd.previousSibling;
    }
    return false;
  }

  @override
  void applyPaintTransform(RenderBox child, Matrix4 transform) {
    final pd = child.parentData! as StickyParentData;
    transform.translate(0.0, pd.dy);
  }

  @override
  void debugFillProperties(DiagnosticPropertiesBuilder properties) {
    super.debugFillProperties(properties);
    properties.add(DoubleProperty('pinBase', _pinBase));
  }
}
