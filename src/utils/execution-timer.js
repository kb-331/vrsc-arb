import { logger } from './logger.js';
import { EventEmitter } from 'events';

export class ExecutionTimer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.timeouts = new Map();
        this.config = {
            orderTimeout: config.orderTimeout || 30000,      // 30 seconds
            settlementTimeout: config.settlementTimeout || 300000, // 5 minutes
            warningThreshold: config.warningThreshold || 0.8 // 80% of timeout
        };
    }

    startExecution(executionId, stages) {
        const execution = {
            id: executionId,
            stages: new Map(),
            startTime: Date.now(),
            warnings: new Set()
        };

        stages.forEach(stage => {
            execution.stages.set(stage, {
                status: 'pending',
                startTime: null,
                duration: null
            });
        });

        this.timeouts.set(executionId, execution);
        this._setExecutionTimeout(executionId);
        
        return execution;
    }

    startStage(executionId, stage) {
        const execution = this.timeouts.get(executionId);
        if (!execution) return;

        const stageInfo = execution.stages.get(stage);
        if (!stageInfo) return;

        stageInfo.status = 'running';
        stageInfo.startTime = Date.now();
        
        this._setStageTimeout(executionId, stage);
    }

    completeStage(executionId, stage) {
        const execution = this.timeouts.get(executionId);
        if (!execution) return;

        const stageInfo = execution.stages.get(stage);
        if (!stageInfo) return;

        stageInfo.status = 'completed';
        stageInfo.duration = Date.now() - stageInfo.startTime;

        this._checkExecutionProgress(executionId);
    }

    _setExecutionTimeout(executionId) {
        const timeout = setTimeout(() => {
            const execution = this.timeouts.get(executionId);
            if (!execution) return;

            const incompleteStages = Array.from(execution.stages.entries())
                .filter(([_, info]) => info.status !== 'completed');

            if (incompleteStages.length > 0) {
                this.emit('executionTimeout', {
                    executionId,
                    incompleteStages: incompleteStages.map(([stage]) => stage),
                    duration: Date.now() - execution.startTime
                });
            }
        }, this.config.settlementTimeout);

        // Warning threshold
        const warningTimeout = setTimeout(() => {
            this._checkExecutionProgress(executionId, true);
        }, this.config.settlementTimeout * this.config.warningThreshold);

        return { timeout, warningTimeout };
    }

    _setStageTimeout(executionId, stage) {
        setTimeout(() => {
            const execution = this.timeouts.get(executionId);
            if (!execution) return;

            const stageInfo = execution.stages.get(stage);
            if (stageInfo && stageInfo.status === 'running') {
                this.emit('stageTimeout', {
                    executionId,
                    stage,
                    duration: Date.now() - stageInfo.startTime
                });
            }
        }, this.config.orderTimeout);
    }

    _checkExecutionProgress(executionId, isWarning = false) {
        const execution = this.timeouts.get(executionId);
        if (!execution) return;

        const totalStages = execution.stages.size;
        const completedStages = Array.from(execution.stages.values())
            .filter(info => info.status === 'completed').length;
        
        const progress = completedStages / totalStages;

        if (isWarning && progress < 1) {
            this.emit('executionWarning', {
                executionId,
                progress,
                duration: Date.now() - execution.startTime
            });
        } else if (progress === 1) {
            this.emit('executionComplete', {
                executionId,
                duration: Date.now() - execution.startTime
            });
            this.timeouts.delete(executionId);
        }
    }

    getExecutionStatus(executionId) {
        return this.timeouts.get(executionId);
    }

    clearExecution(executionId) {
        this.timeouts.delete(executionId);
    }
}