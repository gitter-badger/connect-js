import Config = require('../config');
import GroupedIntervalDataset = require('./grouped-interval-dataset');
import StandardDataset = require('./standard-dataset');
import Dataset = require('./dataset');
import Queries = require('../../core/queries/queries');
import Api = require('../../core/api');
import _ = require('underscore');
import Common = require('../visualization');
import ErrorHandling = require('../error-handling');
import Palette = require('../palette');
import Loader = require('../loader');
import Formatters = require('../formatters');
import Dom = require('../dom');
import ResultHandling = require('../result-handling');

class Gauge implements Common.Visualization {
    public targetElement: HTMLElement;
    public loader: Loader;
    private _options: Config.VisualizationOptions;
    private _minSelectName: string;
    private _maxSelectName: string;
    private _gauge: C3.Chart;
    private _rendered: boolean;
    private _titleElement: HTMLElement;
    private _currentDataset: Dataset.ChartDataset;
    private _duration;
    private _resultHandler: ResultHandling.ResultHandler;
    
    constructor(targetElement: string|HTMLElement, gaugeOptions: Config.VisualizationOptions) {     
        this._options = this._parseOptions(gaugeOptions);
        this.targetElement = Dom.getElement(targetElement);
        this.loader = new Loader(this.targetElement);
        this._resultHandler = new ResultHandling.ResultHandler();
        this._duration = {
            fullReload: null,
            update: 300
        }
    }

    private _parseOptions(gaugeOptions: Config.VisualizationOptions): Config.VisualizationOptions{

        var defaultOptions: Config.VisualizationOptions = {
                fields: {},                
                gauge: {},
            },
            defaultC3Options = Config.defaultC3Options,            
            options = null,
            loadsMinMaxFromResult = null,
            minMaxFromResultsOptions = _.extend(Config.defaultC3Options.minMaxFromResults, defaultC3Options.gauge);

        options = _.extend(defaultOptions, gaugeOptions);
        loadsMinMaxFromResult = _.isString(options.gauge.min + options.gauge.max);

        if (loadsMinMaxFromResult){
            this._minSelectName = _.isString(options.gauge.min) ? options.gauge.min : null;
            this._maxSelectName = _.isString(options.gauge.max) ? options.gauge.max : null;
            options.gauge = _.extend(options.gauge || {}, minMaxFromResultsOptions);
        }else{
            options.gauge = _.extend(options.gauge || {}, defaultC3Options.gauge);
        }

        return options;
    }

    public displayData(resultsPromise: Q.IPromise<Api.QueryResults>, fullReload: boolean = true): void {        
        this._renderGauge();
        this._resultHandler.handleResult(resultsPromise, this, this._loadData, fullReload);
    }

    private _parseMetaData(metadata: Api.Metadata){
        var options = this._options,
            typeOptions = options.gauge,
            parsedMetaData = _.clone(metadata),
            filteredSelected = _.without(metadata.selects, this._minSelectName, this._maxSelectName);

        parsedMetaData.selects = filteredSelected;

        return parsedMetaData;
    }

    private _loadData(results: Api.QueryResults, fullReload: boolean): void {
        var options = this._options,
            typeOptions = options.gauge,
            resultItems = results.results,
            dataset = this._buildDataset(results),
            keys = dataset.getLabels(),
            uniqueKeys = _.unique(keys),
            colors = Palette.getSwatch(uniqueKeys, options.gauge.color ? [options.gauge.color] : null),
            setMinProperty = this._minSelectName && resultItems.length,
            setMaxProperty = this._maxSelectName && resultItems.length,
            minConfigProperty = 'gauge_min',
            maxConfigProperty = 'gauge_max',
            showLabelConfigProperty = 'gauge_label_show',
            internalGaugeConfig = (<any>this._gauge).internal.config,
            transitionDuration = fullReload ? this._duration.fullReload : this._duration.update;
            
        internalGaugeConfig.transition_duration = transitionDuration;
        internalGaugeConfig.gauge_label_format = transition_duration;

        if (setMinProperty){
            internalGaugeConfig[minConfigProperty] = resultItems[0][this._minSelectName];
            internalGaugeConfig[showLabelConfigProperty] = true;
        }

        if (setMaxProperty){
            internalGaugeConfig[maxConfigProperty] = resultItems[0][this._maxSelectName];
            internalGaugeConfig[showLabelConfigProperty] = true;
        }

        this._currentDataset = dataset;
        this._gauge.load({
            json: dataset.getData(),
            keys: {
                x: '_x',
                value: keys
            },
            colors: colors
        });
        this._showTitle();
    }

    public clear(): void{        
        this._rendered = false;
        Dom.removeAllChildren(this.targetElement)
    }

    private _buildDataset(results: Api.QueryResults): Dataset.ChartDataset{
        var options = this._options,
            formatters = {        
                selectLabelFormatter: select => (options.fields[select] || {}).label || select,
                groupValueFormatter: (groupByName, groupValue) => this._formatGroupValue(groupByName, groupValue)
            };

        return new StandardDataset(results, formatters); 
    }

    private _showTitle(){
        var options = this._options,
            titleText = options.title ? options.title.toString() : '',
            showTitle = titleText.length > 0;

        this._titleElement.textContent = titleText;
        this._titleElement.style.display = !showTitle ? 'none' : '';      
    }

    private _formatValueForLabel(label: string, value: any){ 
        var dataset = this._currentDataset,
            select = this._currentDataset.getSelect(label),
            options = this._options,
            fieldOption = options.fields[select] || {},
            valueFormatter = fieldOption.valueFormatter;

        if (valueFormatter){
            return valueFormatter(value);
        }
        
        return value;
    }

    private _formatGroupValue(groupByName: string, groupValue: any){
        var fieldOption = this._options.fields[groupByName] || {},
            valueFormatter = fieldOption.valueFormatter;

        if (valueFormatter){
            return valueFormatter(groupValue);
        }

        return groupValue;
    }

    private _renderGauge() {
        if(this._rendered)
            return;
            
        var options = this._options,
            connectGaugeContainer: HTMLElement = document.createElement('div'),
            c3Element: HTMLElement = document.createElement('div'),
            rootElement = this.targetElement,
            titleElement = document.createElement('span'),
            dateFormat = null,
            tooltipValueFormatter = (value, ratio, id, index) => this._formatValueForLabel(id, value),
            config = {
                bindto: c3Element,
                padding: options.gauge.padding,
                data: {
                    json: [],
                    type: 'gauge'
                },
                transition: {
                    duration: this._duration.fullReload
                },
                tooltip: {
                    format: {
                        value: tooltipValueFormatter
                    }                   
                }
            };

        this.clear();
        titleElement.className = 'connect-viz-title';
        c3Element.className = 'connect-viz-result'
        connectGaugeContainer.className = 'connect-viz connect-chart connect-chart-gauge';
        connectGaugeContainer.appendChild(titleElement);
        connectGaugeContainer.appendChild(c3Element);
        rootElement.appendChild(connectGaugeContainer);
        config['gauge'] = options['gauge'];

        this._rendered = true;
        this._titleElement = titleElement;
        this._showTitle();       
        this._gauge = c3.generate(config);
    }
}

export = Gauge;