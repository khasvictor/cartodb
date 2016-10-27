var _ = require('underscore');
var cdb = require('cartodb.js');
var formatter = require('../../formatter');
var HistogramTitleView = require('./histogram-title-view');
var HistogramChartView = require('./chart');
var placeholder = require('./placeholder.tpl');
var template = require('./content.tpl');
var DropdownView = require('../dropdown/widget-dropdown-view');
var AnimateValues = require('../animate-values.js');
var animationTemplate = require('./animation-template.tpl');

/**
 * Widget content view for a histogram
 */
module.exports = cdb.core.View.extend({
  className: 'CDB-Widget-body',

  defaults: {
    chartHeight: 48 + 20 + 4
  },

  events: {
    'click .js-clear': '_resetWidget',
    'click .js-zoom': '_zoom'
  },

  initialize: function () {
    this._dataviewModel = this.model.dataviewModel;
    this._originalData = this._dataviewModel.getUnfilteredDataModel();
    this.filter = this._dataviewModel.filter;
    this.lockedByUser = false;
    this._initBinds();
  },

  _initViews: function () {
    this._initTitleView();

    var dropdown = new DropdownView({
      model: this.model,
      target: '.js-actions',
      container: this.$('.js-header'),
      flags: {
        normalizeHistogram: true
      }
    });

    this.addView(dropdown);

    this._renderMiniChart();
    this._renderMainChart();
    this._renderAllValues();
  },

  _initTitleView: function () {
    var titleView = new HistogramTitleView({
      widgetModel: this.model,
      dataviewModel: this._dataviewModel
    });

    this.$('.js-title').append(titleView.render().el);
    this.addView(titleView);
  },

  _initBinds: function () {
    this._originalData.once('change:data', this._onFirstLoad, this);
    this.model.bind('change:normalized', function () {
      var normalized = this.model.get('normalized');
      this.histogramChartView.setNormalized(normalized);
      this.miniHistogramChartView.setNormalized(normalized);
    }, this);
    this.model.bind('change:collapsed', this.render, this);
  },

  _onFirstLoad: function () {
    this.render();
    this._dataviewModel.bind('change:data', this._onHistogramDataChanged, this);
    this._dataviewModel.once('change:data', function () {}, this);
    this.add_related_model(this._dataviewModel);
    this._dataviewModel.fetch();
  },

  _isZoomed: function () {
    return this.model.get('zoomed');
  },

  _onHistogramDataChanged: function () {
    // When the histogram is zoomed, we don't need to rely
    // on the change url to update the histogram
    // TODO the widget should not know about the URL… could this state be got from the dataview model somehow?
    if (this._dataviewModel.changed.url && this._isZoomed()) {
      return;
    }

    // if the action was initiated by the user
    // don't replace the stored data
    if (this.lockedByUser) {
      this.lockedByUser = false;
    } else {
      if (!this._isZoomed()) {
        this.histogramChartView.showShadowBars();
        this.miniHistogramChartView.replaceData(this._dataviewModel.getData());
      }
      this.histogramChartView.replaceData(this._dataviewModel.getData());
    }

    if (this.unsettingRange) {
      this._unsetRange();
    }

    this._updateStats();
  },

  render: function () {
    this.clearSubViews();
    this._unbinds();

    var data = this._dataviewModel.getData();
    var originalData = this._originalData.getData();
    var isDataEmpty = !_.size(data) && !_.size(originalData);

    this.$el.html(
      template({
        title: this.model.get('title'),
        showStats: this.model.get('show_stats'),
        itemsCount: !isDataEmpty ? data.length : '-',
        isCollapsed: !!this.model.get('collapsed')
      })
    );

    if (isDataEmpty) {
      this._addPlaceholder();
      this._initTitleView();
    } else {
      this._setupBindings();
      this._initViews();
    }

    return this;
  },

  _unsetRange: function () {
    this.unsettingRange = false;
    this.histogramChartView.replaceData(this._dataviewModel.getData());
    this.model.set({ lo_index: null, hi_index: null });

    if (!this._isZoomed()) {
      this.histogramChartView.showShadowBars();
    }
  },

  _addPlaceholder: function () {
    this.$('.js-content').append(placeholder());
  },

  _renderMainChart: function () {
    this.histogramChartView = new HistogramChartView(({
      margin: { top: 4, right: 4, bottom: 4, left: 4 },
      hasHandles: true,
      hasAxisTip: true,
      width: this.canvasWidth,
      height: this.defaults.chartHeight,
      data: this._dataviewModel.getData(),
      originalData: this._originalData,
      displayShadowBars: !this.model.get('normalized'),
      normalized: this.model.get('normalized')
    }));

    this.$('.js-content').append(this.histogramChartView.el);
    this.addView(this.histogramChartView);

    this.histogramChartView.bind('on_brush_end', this._onBrushEnd, this);
    this.histogramChartView.bind('hover', this._onValueHover, this);
    this.histogramChartView.render().show();
    this.histogramChartView.model.once('change:data', function () {
      var bars = this._calculateBars();
      var lo = bars.loBarIndex;
      var hi = bars.hiBarIndex;
      if (lo !== 0 || hi !== this._dataviewModel.get('bins')) {
        this.histogramChartView.selectRange(lo, hi);
        this.model.set('filter_enabled', true);
      }
    }, this);

    this._updateStats();
  },

  _renderMiniChart: function () {
    this.miniHistogramChartView = new HistogramChartView(({
      className: 'CDB-Chart--mini',
      margin: { top: 0, right: 4, bottom: 4, left: 4 },
      height: 40,
      showOnWidthChange: false,
      data: this._dataviewModel.getData(),
      normalized: this.model.get('normalized'),
      originalData: this._originalData,
      widgetModel: this.model
    }));

    this.addView(this.miniHistogramChartView);
    this.$('.js-content').append(this.miniHistogramChartView.el);
    this.miniHistogramChartView.bind('on_brush_end', this._onMiniRangeUpdated, this);
    this.miniHistogramChartView.render();
  },

  _setupBindings: function () {
    this._dataviewModel.bind('change:bins', this._onChangeBins, this);
    this.model.bind('change:zoomed', this._onChangeZoomed, this);
    this.model.bind('change:zoom_enabled', this._onChangeZoomEnabled, this);
    this.model.bind('change:filter_enabled', this._onChangeFilterEnabled, this);
    this.model.bind('change:total', this._onChangeTotal, this);
    this.model.bind('change:nulls', this._onChangeNulls, this);
    this.model.bind('change:max', this._onChangeMax, this);
    this.model.bind('change:min', this._onChangeMin, this);
    this.model.bind('change:avg', this._onChangeAvg, this);
  },

  _unbinds: function () {
    this._dataviewModel.off('change:bins', this._onChangeBins, this);
    this.model.off('change:zoomed', this._onChangeZoomed, this);
    this.model.off('change:zoom_enabled', this._onChangeZoomEnabled, this);
    this.model.off('change:filter_enabled', this._onChangeFilterEnabled, this);
    this.model.off('change:total', this._onChangeTotal, this);
    this.model.off('change:nulls', this._onChangeNulls, this);
    this.model.off('change:max', this._onChangeMax, this);
    this.model.off('change:min', this._onChangeMin, this);
    this.model.off('change:avg', this._onChangeAvg, this);
  },

  _clearTooltip: function () {
    this.$('.js-tooltip').stop().hide();
  },

  _onValueHover: function (info) {
    var $tooltip = this.$('.js-tooltip');

    if (info && info.data) {
      var bottom = this.defaults.chartHeight + 3 - info.top;

      $tooltip.css({ bottom: bottom, left: info.left });
      $tooltip.text(info.data);
      $tooltip.css({ left: info.left - $tooltip.width() / 2 });
      $tooltip.fadeIn(70);
    } else {
      this._clearTooltip();
    }
  },

  _onMiniRangeUpdated: function (loBarIndex, hiBarIndex) {
    this.lockedByUser = false;

    this._clearTooltip();
    this.histogramChartView.removeSelection();

    var data = this._originalData.getData();

    if (loBarIndex !== hiBarIndex && loBarIndex >= 0 && loBarIndex < data.length && (hiBarIndex - 1) >= 0 && (hiBarIndex - 1) < data.length) {
      this.filter.setRange(
        data[loBarIndex].start,
        data[hiBarIndex - 1].end
      );
      this._updateStats();
    } else {
      console.error('Error accessing array bounds', loBarIndex, hiBarIndex, data);
    }
  },

  _onBrushEnd: function (loBarIndex, hiBarIndex) {
    var data = this._dataviewModel.getData();
    if ((!data || !data.length) || (this.model.get('lo_index') === loBarIndex && this.model.get('hi_index') === hiBarIndex)) {
      return;
    }

    if (this._isZoomed()) {
      this.lockedByUser = true;
    }

    var properties = { filter_enabled: true, lo_index: loBarIndex, hi_index: hiBarIndex };

    if (!this.model.get('zoomed')) {
      properties.zoom_enabled = true;
    }

    this.model.set(properties);

    if (loBarIndex >= 0 && loBarIndex < data.length && (hiBarIndex - 1) >= 0 && (hiBarIndex - 1) < data.length) {
      this.filter.setRange(
        data[loBarIndex].start,
        data[hiBarIndex - 1].end
      );
      this._updateStats();
    } else {
      console.error('Error accessing array bounds', loBarIndex, hiBarIndex, data);
    }
  },

  _onChangeFilterEnabled: function () {
    this.$('.js-filter').toggleClass('is-hidden', !this.model.get('filter_enabled'));
  },

  _onChangeBins: function (mdl, bins) {
    this._originalData.setBins(bins);
    this.model.set({
      zoom_enabled: false,
      filter_enabled: false,
      lo_index: null,
      hi_index: null
    });
  },

  _onChangeZoomEnabled: function () {
    this.$('.js-zoom').toggleClass('is-hidden', !this.model.get('zoom_enabled'));
  },

  _renderAllValues: function () {
    this._changeHeaderValue('.js-nulls', 'nulls', '');
    this._changeHeaderValue('.js-val', 'total', 'SELECTED');
    this._changeHeaderValue('.js-max', 'max', '');
    this._changeHeaderValue('.js-min', 'min', '');
    this._changeHeaderValue('.js-avg', 'avg', '');
  },

  _changeHeaderValue: function (className, what, suffix) {
    if (this.model.get(what) === undefined) {
      this.$(className).text('0 ' + suffix);
      return;
    }

    this._addTitleForValue(className, what, suffix);

    var animator = new AnimateValues({
      el: this.$el
    });

    animator.animateValue(this.model, what, className, animationTemplate, {
      formatter: formatter.formatNumber,
      templateData: { suffix: ' ' + suffix }
    });
  },

  _onChangeNulls: function () {
    this._changeHeaderValue('.js-nulls', 'nulls', '');
  },

  _onChangeTotal: function () {
    this._changeHeaderValue('.js-val', 'total', 'SELECTED');
  },

  _onChangeMax: function () {
    this._changeHeaderValue('.js-max', 'max', '');
  },

  _onChangeMin: function () {
    this._changeHeaderValue('.js-min', 'min', '');
  },

  _onChangeAvg: function () {
    this._changeHeaderValue('.js-avg', 'avg', '');
  },

  _addTitleForValue: function (className, what, unit) {
    this.$(className).attr('title', this._formatNumberWithCommas(this.model.get(what).toFixed(2)) + ' ' + unit);
  },

  _formatNumberWithCommas: function (x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  _calculateBars: function () {
    var data = this._dataviewModel.getData();
    var min = this.model.get('min');
    var max = this.model.get('max');
    var loBarIndex = this.model.get('lo_index');
    var hiBarIndex = this.model.get('hi_index');
    var startMin;
    var startMax;

    if (data.length > 0) {
      if (!_.isNumber(min) && !_.isNumber(loBarIndex)) {
        loBarIndex = 0;
      } else if (_.isNumber(min) && !_.isNumber(loBarIndex)) {
        startMin = _.findWhere(data, {start: min});
        loBarIndex = startMin && startMin.bin || 0;
      }

      if (!_.isNumber(max) && !_.isNumber(hiBarIndex)) {
        hiBarIndex = data.length;
      } else if (_.isNumber(max) && !_.isNumber(hiBarIndex)) {
        startMax = _.findWhere(data, {end: max});
        hiBarIndex = startMax && startMax.bin + 1 || data.length;
      }
    } else {
      loBarIndex = 0;
      hiBarIndex = data.length;
    }

    return {
      loBarIndex: loBarIndex,
      hiBarIndex: hiBarIndex
    };
  },

  _updateStats: function () {
    var data = this._dataviewModel.getData();
    var nulls = this._dataviewModel.get('nulls');
    var bars = this._calculateBars();
    var loBarIndex = bars.loBarIndex;
    var hiBarIndex = bars.hiBarIndex;
    var sum, avg, min, max;

    if (data && data.length) {
      sum = this._calcSum(data, loBarIndex, hiBarIndex);
      avg = this._calcAvg(data, loBarIndex, hiBarIndex);

      if (loBarIndex >= 0 && loBarIndex < data.length) {
        min = data[loBarIndex].start;
      }

      if (hiBarIndex >= 0 && hiBarIndex - 1 < data.length) {
        max = data[Math.max(0, hiBarIndex - 1)].end;
      }

      this.model.set({ total: sum, nulls: nulls, min: min, max: max, avg: avg, lo_index: loBarIndex, hi_index: hiBarIndex });
    }
  },

  _calcAvg: function (data, start, end) {
    var selectedData = data.slice(start, end);

    var total = this._calcSum(data, start, end, total);

    if (!total) {
      return 0;
    }

    var area = _.reduce(selectedData, function (memo, d) {
      return (d.avg && d.freq) ? (d.avg * d.freq) + memo : memo;
    }, 0);

    return area / total;
  },

  _calcSum: function (data, start, end) {
    return _.reduce(data.slice(start, end), function (memo, d) {
      return d.freq + memo;
    }, 0);
  },

  _onChangeZoomed: function () {
    if (this.model.get('zoomed')) {
      this._onZoomIn();
    } else {
      this._resetWidget();
    }
  },

  _showMiniRange: function () {
    var loBarIndex = this.model.get('lo_index');
    var hiBarIndex = this.model.get('hi_index');

    this.miniHistogramChartView.selectRange(loBarIndex, hiBarIndex);
    this.miniHistogramChartView.show();
  },

  _zoom: function () {
    this.model.set({ zoomed: true, zoom_enabled: false });
    this.histogramChartView.removeSelection();
  },

  _onZoomIn: function () {
    this.lockedByUser = false;
    this._showMiniRange();
    this.histogramChartView.setBounds();
    this._dataviewModel.enableFilter();
    this._dataviewModel.fetch();
  },

  _resetWidget: function () {
    this.filter.unsetRange();
    this._dataviewModel.disableFilter();
    this.histogramChartView.unsetBounds();
    this.miniHistogramChartView.hide();
    this.model.set({
      zoomed: false,
      zoom_enabled: false,
      filter_enabled: false,
      lo_index: null,
      hi_index: null,
      min: null,
      max: null
    });
    this._updateStats();
  }
});