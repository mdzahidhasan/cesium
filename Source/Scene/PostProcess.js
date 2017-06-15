/*global define*/
define([
        '../Core/Check',
        '../Core/Color',
        '../Core/combine',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/loadImage',
        '../Core/Math',
        '../Core/PixelFormat',
        '../Renderer/Framebuffer',
        '../Renderer/PixelDatatype',
        '../Renderer/RenderState',
        '../Renderer/Sampler',
        '../Renderer/Texture',
        '../Renderer/TextureMagnificationFilter',
        '../Renderer/TextureMinificationFilter',
        '../Renderer/TextureWrap',
        './BlendingState',
        './PostProcessStage'
    ], function(
        Check,
        Color,
        combine,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        loadImage,
        CesiumMath,
        PixelFormat,
        Framebuffer,
        PixelDatatype,
        RenderState,
        Sampler,
        Texture,
        TextureMagnificationFilter,
        TextureMinificationFilter,
        TextureWrap,
        BlendingState,
        PostProcessStage) {
    'use strict';

    /**
     * @private
     */
    function PostProcess(options) {
        this._stages = options.stages;
        this._blend = defaultValue(options.blend, true);
        this._overwriteInput = defaultValue(options.overwriteInput, false);

        this._framebuffers = undefined;
        this._colorTextures = undefined;
        this._innerStages = undefined;
        this._cache = undefined;

        // Check for changes
        this._inputFramebuffer = undefined;
        this._outputFramebuffer = undefined;
        this._stagesActive = undefined;
    }

    defineProperties(PostProcess.prototype, {
        active : {
            get : function() {
                var stages = this._stages;
                var length = stages.length;
                for (var i = 0; i < length; ++i) {
                    if (stageActive(stages[i])) {
                        return true;
                    }
                }
                return false;
            }
        }
    });

    function CachedTexture() {
        this.count = 0;
        this.texture = undefined;
    }

    function PostProcessCache() {
        this.textures = [
            new CachedTexture(),
            new CachedTexture()
        ];
    }

    PostProcessCache.prototype.createTexture = function(index, context) {
        var cachedTexture = this.textures[index];
        var count = ++cachedTexture.count;
        if (count === 1) {
            var screenWidth = context.drawingBufferWidth;
            var screenHeight = context.drawingBufferHeight;
            cachedTexture.texture = new Texture({
                context : context,
                width : screenWidth,
                height : screenHeight,
                pixelFormat : PixelFormat.RGBA,
                pixelDatatype : PixelDatatype.UNSIGNED_BYTE,
                sampler : createSampler()
            });
        }
        return cachedTexture.texture;
    };

    PostProcessCache.prototype.destroyTexture = function(index, context) {
        var cachedTexture = this.textures[index];
        var count = --cachedTexture.count;
        if (count === 0) {
            cachedTexture.texture.destroy();
            cachedTexture.texture = undefined;
        }
    };

    PostProcessCache.prototype.invalidate = function() {
        var firstTexture = 
        if (defined(this.textures[0].texture)) {

        }
    };

    function destroyTextures(processor, context) {
        var colorTextures = processor._colorTextures;
        var inputColorTexture = processor._inputFramebuffer.getColorTexture(0);
        if (defined(colorTextures)) {
            var length = colorTextures.length;
            for (var i = 0; i < length; ++i) {
                var colorTexture = colorTextures[i];
                if (colorTexture !== inputColorTexture) {
                    processor._cache.destroyTexture(i, context);
                }
            }
            processor._colorTextures = undefined;
        }
    }

    function destroyFramebuffers(processor) {
        var framebuffers = processor._framebuffers;
        if (defined(framebuffers)) {
            var length = framebuffers.length;
            for (var i = 0; i < length; ++i) {
                framebuffers[i].destroy();
            }
            processor._framebuffers = undefined;
        }
    }

    function destroyDrawCommands(processor) {
        var innerStages = processor._innerStages;
        if (defined(innerStages)) {
            var length = innerStages.length;
            for (var i = 0; i < length; ++i) {
                var stage = innerStages[i];
                stage._drawCommand.shaderProgram.destroy();
                stage._drawCommand = undefined;
            }
        }
    }

    function createRenderState(processor) {
        if (processor._blend) {
            return RenderState.fromCache({
                blending : BlendingState.ALPHA_BLEND
            });
        }

        return RenderState.fromCache();
    }

    function createDrawCommands(processor, context) {
        var innerStages = processor._innerStages;
        var length = innerStages.length;
        for (var i = 0; i < length; ++i) {
            var stage = innerStages[i];
            stage._drawCommand = context.createViewportQuadCommand(stage._fragmentShader, {
                renderState : createRenderState(processor),
                owner : processor
            });
        }
    }

    function createPassthroughStage() {
        var fragmentShader =
            'uniform sampler2D u_colorTexture; \n' +
            'varying vec2 v_textureCoordinates; \n' +
            'void main() \n' +
            '{ \n' +
            '    vec4 color = texture2D(u_colorTexture, v_textureCoordinates); \n' +
            '    gl_FragColor = color; \n' +
            '} \n';

        return new PostProcessStage({
            fragmentShader : fragmentShader
        });
    }

    function stageActive(stage) {
        return stage.show && stage.ready;
    }

    function createStages(processor, inputFramebuffer, outputFramebuffer) {
        var innerStages = [];
        var stagesActive = [];
        processor._innerStages = innerStages;
        processor._stagesActive = stagesActive;

        var i;
        var stage;
        var stages = processor._stages;
        var length = stages.length;
        for (i = 0; i < length; ++i) {
            stage = stages[i];
            var active = stageActive(stage);
            stagesActive.push(active);
            if (!active) {
                continue;
            }
            var subStages = stage._stages;
            if (defined(subStages)) {
                var subStagesLength = subStages.length;
                for (var j = 0; j < subStagesLength; ++j) {
                    innerStages.push(subStages[j]);
                }
            } else {
                innerStages.push(stage);
            }
        }

        // Cannot read and write to the same framebuffer simultaneously, add a passthrough stage.
        if (inputFramebuffer === outputFramebuffer && innerStages.length === 1) {
            var passthroughStage = createPassthroughStage();
            innerStages.push(passthroughStage);
        }
    }

    function createSampler() {
        return new Sampler({
            wrapS : TextureWrap.CLAMP_TO_EDGE,
            wrapT : TextureWrap.CLAMP_TO_EDGE,
            minificationFilter : TextureMinificationFilter.NEAREST,
            magnificationFilter : TextureMagnificationFilter.NEAREST
        });
    }

    function createTextures(processor, context) {
        var inputColorTexture = processor._inputFramebuffer.getColorTexture(0);
        var innerStages = processor._innerStages;
        var length = CesiumMath.clamp(innerStages.length - 1, 0, 2);
        var colorTextures = new Array(length);
        processor._colorTextures = colorTextures;

        if (length >= 1) {
            colorTextures[0] = processor._cache.createTexture(0, context);
        }
        if (length === 2) {
            colorTextures[1] = processor._overwriteInput ? inputColorTexture : processor._cache.createTexture(1, context);
        }
    }

    function createFramebuffers(processor, context) {
        var colorTextures = processor._colorTextures;
        var length = colorTextures.length;
        var framebuffers = new Array(length);
        processor._framebuffers = framebuffers;

        for (var i = 0; i < length; ++i) {
            framebuffers[i] = new Framebuffer({
                context : context,
                colorTextures : [colorTextures[i]],
                destroyAttachments : false
            });
        }
    }

    function getUniformFunction(stage, name) {
        return function() {
            return stage._uniformValues[name];
        };
    }

    function createUniformMap(stage, colorTexture) {
        var uniformMap = {};
        var uniformValues = stage._uniformValues;
        for (var name in uniformValues) {
            if (uniformValues.hasOwnProperty(name)) {
                var uniformName = 'u_' + name;
                uniformMap[uniformName] = getUniformFunction(stage, name);
            }
        }

        return combine(uniformMap, {
            u_colorTexture : function() {
                return colorTexture;
            }
        });
    }

    function linkStages(processor, inputFramebuffer, outputFramebuffer) {
        var innerStages = processor._innerStages;
        var colorTextures = processor._colorTextures;
        var framebuffers = processor._framebuffers;

        var length = innerStages.length;
        for (var i = 0; i < length; ++i) {
            var colorTexture;
            if (i === 0) {
                colorTexture = inputFramebuffer.getColorTexture(0);
            } else {
                colorTexture = colorTextures[(i + 1) % colorTextures.length];
            }

            var framebuffer;
            if (i === length - 1) {
                framebuffer = outputFramebuffer;
            } else {
                framebuffer = framebuffers[i % framebuffers.length];
            }

            var stage = innerStages[i];
            var drawCommand = stage._drawCommand;
            drawCommand.uniformMap = createUniformMap(stage, colorTexture);
            drawCommand.framebuffer = framebuffer;
        }
    }

    function isDirty(processor, inputFramebuffer, outputFramebuffer, context) {
        var screenWidth = context.drawingBufferWidth;
        var screenHeight = context.drawingBufferHeight;

        var stages = processor._stages;
        var innerStages = processor._innerStages;
        var stagesActive = processor._stagesActive;

        if (!defined(innerStages)) {
            return true;
        }

        if (inputFramebuffer !== processor._inputFramebuffer || outputFramebuffer !== processor._outputFramebuffer) {
            processor._inputFramebuffer = inputFramebuffer;
            processor._outputFramebuffer = outputFramebuffer;
            return true;
        }

        var i;
        var length = stages.length;
        var activeDirty = false;
        for (i = 0; i < length; ++i) {
            var active = stageActive(stages[i]);
            if (active !== stagesActive[i]) {
                stagesActive[i] = active;
                activeDirty = true;
            }
        }
        if (activeDirty) {
            return true;
        }

        var colorTextures = processor._colorTextures;
        length = colorTextures.length;
        for (i = 0; i < length; ++i) {
            var colorTexture = colorTextures[i];
            if (colorTexture.isDestroyed()) {
                // Cached texture may have been destroyed due to resize
                return true;
            }
            if ((colorTexture.width !== screenWidth) || (colorTexture.height !== screenHeight)) {
                return true;
            }
        }

        return false;
    }

    PostProcess.prototype.execute = function(frameState, inputFramebuffer, outputFramebuffer) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.object('frameState', frameState);
        Check.typeOf.object('inputFramebuffer', inputFramebuffer);
        //>>includeEnd('debug');

        var context = frameState.context;

        var cache = context.cache.postProcess;
        if (!defined(cache)) {
            cache = new PostProcessCache();
            context.cache.postProcess = cache;
        }
        this._cache = cache;



        var i;
        var stages = this._stages;
        var length = stages.length;
        for (i = 0; i < length; ++i) {
            stages[i].update(frameState);
        }

        if (isDirty(this, inputFramebuffer, outputFramebuffer, context)) {
            destroyDrawCommands(this);
            destroyTextures(this);
            destroyFramebuffers(this);
            createStages(this, inputFramebuffer, outputFramebuffer);
            createDrawCommands(this, context);
            createTextures(this, context, inputFramebuffer);
            createFramebuffers(this, context);
            linkStages(this, inputFramebuffer, outputFramebuffer);
        }

        var innerStages = this._innerStages;
        length = innerStages.length;
        for (i = 0; i < length; ++i) {
            innerStages[i]._drawCommand.execute(context);
        }
    };

    PostProcess.prototype.isDestroyed = function() {
        return false;
    };

    PostProcess.prototype.destroy = function() {
        destroyDrawCommands();
        destroyTextures();
        destroyFramebuffers();
        return destroyObject(this);
    };

    return PostProcess;
});
