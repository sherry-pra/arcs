/**
 * @license
 * Copyright 2019 Google LLC.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import {PolymerElement} from '../deps/@polymer/polymer/polymer-element.js';
import '../deps/@polymer/iron-icons/iron-icons.js';
import '../deps/@polymer/iron-icons/editor-icons.js';
import '../deps/@polymer/iron-icons/maps-icons.js';
import '../deps/@polymer/iron-icons/image-icons.js';
import '../deps/@vaadin/vaadin-split-layout/vaadin-split-layout.js';
import '../deps/vis/dist/vis-timeline-graph2d.min.js';
import {formatTime, indentPrint, MessengerMixin} from './arcs-shared.js';


const $_documentContainer = document.createElement('template');
$_documentContainer.setAttribute('style', 'display: none;');

$_documentContainer.innerHTML = `<dom-module id="arcs-tracing">
  <template>
    <style include="shared-styles vis-timeline-graph2d.min.css">
      :host {
        display: block;
      }
      #timelineContainer {
        width: 100%;
        height: 100vh;
      }
      aside > div {
        padding: 5px;
        border: 1px solid var(--mid-gray);
        background-color: white;
      }
      .controls {
        text-align: center;
      }
      .buttons-panel {
        display: flex;
        justify-content: space-evenly;
        margin-bottom: 5px;
      }
      .vis-timeline {
        border: 0;
      }
      .vis-item.vis-background {
        border: 4px solid transparent;
        border-left: 4px solid rgba(0, 150, 0, .5);
      }
      .vis-item.vis-background.final {
        border-right: 4px solid rgba(150, 0, 0, .5);
      }
      .vis-item.vis-background:not(.final) {
        background: linear-gradient(to right, rgba(213, 221, 246, .4) 50%, transparent);
        border-right: 0;
      }
      .vis-custom-time.startup {
        /* Makes page startup time vertical line not draggable. */
        pointer-events: none;
      }
    </style>
    <vaadin-split-layout>
      <div id="timelineContainer" style="flex: .8"></div>
      <aside style="flex: .2" class="paddedBlocks">
        <div class="controls">
          <div class="buttons-panel">
            <iron-icon on-click="_fit" title="Fit to events" icon="maps:zoom-out-map"></iron-icon>
            <iron-icon on-click="_redraw" title="Redraw timeline if looks weird" icon="image:brush"></iron-icon>
          </div>
          zoom-key: ctrl
        </div>
        <template is="dom-if" if="{{_selectedItem}}">
          <div id="details">
            [[_selectedItem.group]]: [[_selectedItem.content]]
            <hr>
            <div>Sync duration: [[_syncDurationDetail(_selectedItem)]]</div>
            <template is="dom-if" if="[[_isAsyncEvent(_selectedItem)]]">
              <div>Async duration: [[_asyncDurationDetail(_selectedItem)]]</div>
            </template>
            <div>Start: [[_startTimeDetail(_selectedItem)]]</div>
            <div>End: [[_endTimeDetail(_selectedItem)]]</div>
            <hr>
            Args:
            <pre>[[_indentPrint(_selectedItem.args)]]</pre>
          </div>
        </div></div></div></template>
      </aside>
    </vaadin-split-layout>
  </template>

</dom-module>`;

document.head.appendChild($_documentContainer.content);
class ArcsTracing extends MessengerMixin(PolymerElement) {
  static get is() { return 'arcs-tracing'; }

  static get properties() {
    return {
      active: {
        type: Boolean,
        observer: '_activeChanged',
        reflectToAttribute: true
      }
    };
  }

  constructor() {
    super();
    this._timeline = null;
    this._items = new vis.DataSet({queue: true});
    this._groups = new vis.DataSet({queue: true});
    this._selectedItem = null;
    this._timeBase = 0;
  }

  onMessageBundle(messages) {
    let needsRedraw = false;
    const flowEventsCache = new Map();

    for (const msg of messages) {
      switch (msg.messageType) {
        case 'startup-time':
          if (this._timeline) {
            if (this._hasStartupTime) {
              this._timeline.setCustomTime(msg.messageBody, 'startup');
            } else {
              this._timeline.addCustomTime(msg.messageBody, 'startup');
              this._hasStartupTime = true;
            }
          } else {
            this._startupTime = msg.messageBody;
          }
          break;
        case 'trace-time-sync':
          this._timeBase = msg.messageBody.localTime - msg.messageBody.traceTime / 1000;
          break;
        case 'trace': {
          needsRedraw = true;

          const trace = msg.messageBody;
          const group = trace.cat;

          this._groups.update({
            id: group,
            content: group,
            visible: this.active
          });

          let subgroup;
          if (trace.seq) {
            subgroup = trace.seq;
          } else {
            subgroup = trace.name;
            if (subgroup.endsWith(' (async)')) subgroup = subgroup.slice(0, -8);
          }

          if (trace.ph === 'X') { // Duration event.
            const start = Math.floor(trace.ts / 1000 + this._timeBase);
            const end = Math.ceil((trace.ts + trace.dur) / 1000 + this._timeBase);

            this._items.update({
              id: `${trace.cat}_${trace.name}_${trace.ts}`,
              content: trace.name,
              title: trace.name,
              group,
              subgroup,
              start,
              end,
              ts: trace.ts,
              dur: trace.dur,
              args: trace.args,
              flowId: trace.flowId
            });

            // Flow events (types 's', 't', 'f') have timestamps such that
            // the flow begins with the end of the first duration event and
            // ends at the beginning of the last duration event. This doesn't
            // visualize nicely with out 'background' method, so here we're
            // expanding the flow to encapsulate all duration events.
            if (trace.flowId) {
              // See comment about flowEventsCache below.
              // Updates to _items are only visible after flush() below.
              const flowItem = flowEventsCache.get(trace.flowId)
                  || this._items.get(trace.flowId)
                  || {start, end};
              const item = {
                id: trace.flowId,
                start: Math.min(flowItem.start, start),
                end: Math.max(flowItem.end, end),
              };
              this._items.update(item);
              flowEventsCache.set(trace.flowId, item);
            }
          } else { // Flow event, trace.ph one of ['s', 't', 'f'].
            // We store updated item in the flowEventsCache, to accumulate
            // changes from messages in the same bundle, as changes on the
            // _items dataset are only visible on flush().

            let start;
            let end;
            start = end = [trace.ts / 1000 + this._timeBase];
            for (const item of [
                this._items.get(trace.id),
                flowEventsCache.get(trace.id),
                ...this._items.get({filter: elem => elem.flowId === trace.id})]) {
              if (item) {
                start = Math.min(item.start, start);
                end = Math.max(item.end, end);
              }
            }

            const item = {
              id: trace.id,
              group,
              subgroup,
              type: 'background',
              start: Math.floor(start),
              end: Math.ceil(end),
              className: trace.ph === 'f' ? 'final' : ''
            };

            flowEventsCache.set(trace.id, item);
            this._items.update(item);
          }
          break;
        }
        case 'page-refresh':
          needsRedraw = true;
          this._groups.clear();
          this._items.clear();
          this._startupTime = null;
          if (this._timeline && this._hasStartupTime) {
            this._timeline.removeCustomTime('startup');
            this._hasStartupTime = false;
          }
          this._autoWindowResize = true;
          break;
      }
    }

    if (!needsRedraw) return;

    this._groups.flush();
    this._items.flush();

    if (!this._timeline && this._items.length > 0) {
      this._timeline = new vis.Timeline(this.$.timelineContainer, this._items, this._groups, {
        verticalScroll: true,
        horizontalScroll: true,
        zoomKey: 'ctrlKey',
        width: '100%',
        height: '100%',
        stack: false,
        stackSubgroups: true,
        showCurrentTime: true,
        orientation: 'top',
        zoomMax: 1000 * 60 * 60, // Max zoom-out is 1 hour.
        end: this._aBitInTheFuture(),
      });
      this._timeline.on('itemover', props => {
        this._selectedItem = this._items.get(props.item);
      });
      this._timeline.on('rangechange', ({byUser}) => {
        if (byUser) this._autoWindowResize = false;
      });
      if (this._startupTime) {
        this._timeline.addCustomTime(this._startupTime, 'startup');
        this._hasStartupTime = true;
      }
    } else if (this._timeline && this._autoWindowResize) {
      this._fit();
    }
  }

  _aBitInTheFuture() {
    return Date.now() + 2000;
  }

  _startTimeDetail(item) {
    return formatTime(item.ts / 1000 + this._timeBase, 6 /* with Micros */);
  }

  _endTimeDetail(item) {
    return formatTime((item.ts + item.dur) / 1000 + this._timeBase, 6 /* with Micros */);
  }

  _syncDurationDetail(item) {
    return this._displayDuration(item.dur);
  }

  _isAsyncEvent(item) {
    return item.flowId !== undefined;
  }

  _asyncDurationDetail(item) {
    let start = item.ts;
    let end = item.ts + item.dur;
    this._items.forEach(elem => {
      start = Math.min(start, elem.ts);
      end = Math.max(end, elem.ts + elem.dur);
    }, {filter: elem => elem.flowId === item.flowId});
    return this._displayDuration(end - start);
  }

  _displayDuration(duration) {
    if (duration < 1000) {
      return `${duration.toFixed(0)}µs`;
    } else if (duration < 1000 * 1000) {
      return `${(duration / 1000).toFixed(3)}ms`;
    } else {
      return `${(duration / (1000 * 1000)).toFixed(3)}s`;
    }
  }

  _indentPrint(thing) {
    return indentPrint(thing); // from arcs-shared
  }

  _activeChanged(active) {
    // Avoiding jank by rendering only if it is an active page.
    this._groups.forEach(g => {
      this._groups.update({id: g.id, visible: active});
    });
    this._groups.flush();
  }

  _redraw() {
    if (this._timeline) this._timeline.redraw();
  }

  _fit() {
    this._autoWindowResize = true;
    if (this._timeline && this._items.length > 0) {
      // There's timeline.fit(), but it doesn't leave margins and looks weird.
      const start = this._items.min('start').start;
      let end = this._items.max('end').end;
      end = end + (end - start) * .1;
      this._timeline.setWindow({start, end});
    }
  }
}

window.customElements.define(ArcsTracing.is, ArcsTracing);
