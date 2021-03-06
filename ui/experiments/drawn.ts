/// <reference path="../src/microReact.ts" />
/// <reference path="../src/api.ts" />
/// <reference path="../src/client.ts" />
/// <reference path="../src/tableEditor.ts" />
/// <reference path="../src/glossary.ts" />
module eveEditor {
  var localState = api.localState;
  var ixer = api.ixer;
  var code = api.code;
  var DEBUG = window["DEBUG"];

  export function executeDispatch(diffs, storeEvent, sendToServer) {
    if(diffs && diffs.length) {
      if(storeEvent) {
        var eventItem = {event: event, diffs: diffs, children: [], parent: eventStack, localState: api.clone(localState), root: false};
        eventStack.children.push(eventItem);
        eventStack = eventItem;
      }

      ixer.handleDiffs(diffs);
      if(sendToServer) {
        if(DEBUG.DELAY) {
          setTimeout(function() {
            client.sendToServer(diffs, false);
          }, DEBUG.DELAY);
        } else {
          client.sendToServer(diffs, false);
        }
      }

    } else {
      //       console.warn("No diffs to index, skipping.");
    }

    //@TODO: since we don't have a way to determine if localState has changed, we have
    //to render anytime dispatch is called
    drawn.render();
  }
}

module drawn {

  declare var uuid;
  const localState = api.localState;
  const ixer = api.ixer;
  const code = api.code;

  //---------------------------------------------------------
  // Constants
  //---------------------------------------------------------

  const nodeWidthMultiplier = 9;
  const nodeSmallWidthMultiplier = 8;
  const nodeWidthPadding = 10;
  const nodeHeight = 18;
  const nodeHeightPadding = 3;
  const nodeWidthMin = 50;

  //---------------------------------------------------------
  // Utils
  //---------------------------------------------------------

   function coerceInput(input) {
        if (input.match(/^-?[\d]+$/gim)) {
            return parseInt(input);
        }
        else if (input.match(/^-?[\d]+\.[\d]+$/gim)) {
            return parseFloat(input);
        }
        else if (input === "true") {
            return true;
        }
        else if (input === "false") {
            return false;
        }
        return input;
    }

    function stopPropagation(e) {
        e.stopPropagation();
    }

    function preventDefault(e) {
        e.preventDefault();
    }

    function focusOnce(node, elem) {
        if (!elem.__focused) {
            setTimeout(function () { node.focus(); }, 5);
            elem.__focused = true;
        }
    }

	//---------------------------------------------------------
  // Renderer
  //---------------------------------------------------------

  export var renderer = new microReact.Renderer();
  document.body.appendChild(renderer.content);
  renderer.queued = false;
  export function render() {
   if(renderer.queued === false) {
      renderer.queued = true;
      // @FIXME: why does using request animation frame cause events to stack up and the renderer to get behind?
      setTimeout(function() {
      // requestAnimationFrame(function() {
        var start = performance.now();
        var tree = root();
        var total = performance.now() - start;
        if(total > 10) {
          console.log("Slow root: " + total);
        }
        renderer.render(tree);
        renderer.queued = false;
      }, 16);
    }
  }

  window.addEventListener("resize", render);

  //---------------------------------------------------------
  // localState
  //---------------------------------------------------------

  localState.selectedNodes = {};
  localState.overlappingNodes = {};

  var fieldToEntity = {
    "source: source": "source",
    "source: view": "view",
    "source: source view": "view",
    "field: field": "field",
    "field: view": "view",
    "place: place": "place",
    "place to image: place": "place",
    "place to address: place": "place",
  }

  export var entities = [];
  for(var field in fieldToEntity) {
    var ent = fieldToEntity[field];
    if (entities.indexOf(ent) === -1) {
      entities.push(ent);
    }
  }

  export var positions = {}

  function loadPositions() {
    var loadedPositions = ixer.select("editor node position", {});
    for(var pos of loadedPositions) {
      positions[pos["editor node position: node"]] = {top: pos["editor node position: y"], left: pos["editor node position: x"]};
    }
  }

  localState.drawnUiActiveId = false;
  localState.errors = [];

  //---------------------------------------------------------
  // Node helpers
  //---------------------------------------------------------

  function findNodesIntersecting(currentNode, nodes, nodeLookup) {
    let currentNodePosition = nodeDisplayInfo(currentNode);
    let overlaps = [];
    for (let node of nodes) {
      if (node.id === currentNode.id) continue;
      let nodePosition = nodeDisplayInfo(nodeLookup[node.id]);

      if (currentNodePosition.left + currentNodePosition.width > nodePosition.left &&
        currentNodePosition.left < nodePosition.left + nodePosition.width &&
        currentNodePosition.top + currentNodePosition.height > nodePosition.top &&
        currentNodePosition.top < nodePosition.top + nodePosition.height) {
        overlaps.push(node.id);
      }
    }
    return overlaps;
  }

  function intersectionAction(nodeA, nodeB): any {
    //given two nodes, we check to see if their intersection should cause something to happen
    //e.g. two attributes intersecting would signal joining them
    if(nodeA.type === "attribute" && nodeB.type === "attribute") {
      return "joinNodes";
    }
    return false;
  }

  function actionableIntersections(viewId, currentNodeId, radius = 30) {
    let {nodeLookup, nodes} = viewToEntityInfo(ixer.selectOne("view", {view: viewId}));
    let overlaps = findNodesIntersecting(nodeLookup[currentNodeId], nodes, nodeLookup);
    let curNode = nodeLookup[currentNodeId];
    let actions = [];
    let lookup = {};
    for(let overlappingId of overlaps) {
      let overlappingNode = nodeLookup[overlappingId];
      let action = intersectionAction(curNode, overlappingNode);
      if(action) {
        let info = {node: curNode, target: overlappingNode, action};
        actions.push(info);
        lookup[overlappingId] = info;
      }
    }
    return {actions, lookup};
  }

  function getNodesInRectangle(viewId, box) {
    let {nodes} = viewToEntityInfo(ixer.selectOne("view", {view: viewId}));
    let boxLeft = Math.min(box.start.x, box.end.x);
    let boxRight = Math.max(box.start.x, box.end.x)
    let boxTop = Math.min(box.start.y, box.end.y);
    let boxBottom = Math.max(box.start.y, box.end.y);
    return nodes.map((node) => {
      return {node, displayInfo: nodeDisplayInfo(node)};
    }).filter((info) => {
      let {node, displayInfo} = info;
      let overlapLeft = Math.max(boxLeft, displayInfo.left);
      let overlapRight = Math.min(boxRight, displayInfo.left + displayInfo.width);
      let overlapTop = Math.max(boxTop, displayInfo.top);
      let overlapBottom = Math.min(boxBottom, displayInfo.top + displayInfo.height);
      return overlapLeft < overlapRight && overlapTop < overlapBottom;
    });
  }

  function nodesToRectangle(nodes) {
    let top = Infinity;
    let left = Infinity;
    let bottom = -Infinity;
    let right = -Infinity;
    for(var node of nodes) {
      let info = nodeDisplayInfo(node);
      if(info.left < left) left = info.left;
      if(info.left + info.width > right) right = info.left + info.width;
      if(info.top < top) top = info.top;
      if(info.top + info.height > bottom) bottom = info.top + info.height;
    }
    return {top, left, width: right - left, height: bottom - top};
  }

  //---------------------------------------------------------
  // AST helpers
  //---------------------------------------------------------

  function removeVariable(variableId) {
    let diffs = [];
    diffs.push(api.remove("variable (new)", {variable: variableId}));
    diffs.push(api.remove("constant (new)", {variable: variableId}));
    // we need to remove any bindings to this variable
    diffs.push(api.remove("binding (new)", {variable: variableId}));
    diffs.push(api.remove("ordinal binding", {variable: variableId}));
    // we also need to remove any fields and selects that pull from the variable
    let selects = ixer.select("select (new)", { variable: variableId });
    for(let select of selects) {
      let fieldId = select["select (new): field"];
      diffs.push(api.remove("field", { field: fieldId }));
      diffs.push(api.remove("select (new)", { variable: variableId }));
    }
    return diffs;
  }

  function removeSource(sourceId) {
    var diffs = [
      api.remove("source", {source: sourceId}),
      api.remove("binding (new)", {source: sourceId})
    ]
    let bindings = ixer.select("binding (new)", {source: sourceId});
    for(let binding of bindings) {
      let variableId = binding["binding (new): variable"];
      // determine if this is the only binding for this variable
      let singleBinding = ixer.select("binding (new)", {variable: variableId}).length === 1;
      // if this variable is only bound to this field, then we need to remove it
      if(singleBinding) {
        diffs.push.apply(diffs, removeVariable(variableId));
      }
    }
    let ordinal = ixer.selectOne("ordinal binding", {source: sourceId});
    if(ordinal) {
       diffs.push.apply(diffs, removeVariable(ordinal["ordinal binding: variable"]));
    }
    return diffs;
  }

  function addSourceFieldVariable(queryId, sourceViewId, sourceId, fieldId) {
    let diffs = [];
    let kind;
    // check if we're adding an ordinal
    if(fieldId === "ordinal") {
      kind = "ordinal";
    } else {
      kind = ixer.selectOne("field", {field: fieldId})["field: kind"];
    }
    // add a variable
    let variableId = uuid();
    diffs.push(api.insert("variable (new)", {view: queryId, variable: variableId}));
    if(kind === "ordinal") {
      // create an ordinal binding
      diffs.push(api.insert("ordinal binding", {variable: variableId, source: sourceId}));
    } else {
      // bind the field to it
      diffs.push(api.insert("binding (new)", {variable: variableId, source: sourceId, field: fieldId}));
    }
    if(kind === "output" || kind === "ordinal") {
      // select the field
      diffs.push.apply(diffs, dispatch("addSelectToQuery", {viewId: queryId, variableId: variableId, name: code.name(fieldId) || fieldId}, true));
    } else {
      // otherwise we're an input field and we need to add a default constant value
      diffs.push(api.insert("constant (new)", {variable: variableId, value: api.newPrimitiveDefaults[sourceViewId][fieldId]}));
    }
    return diffs;
  }

  //---------------------------------------------------------
  // Dispatch
  //---------------------------------------------------------

  function dispatch(event, info, rentrant?) {
    //console.log("dispatch[" + event + "]", info);
    var diffs = [];
    switch(event) {
      //---------------------------------------------------------
      // Node selection
      //---------------------------------------------------------
      case "selectNode":
        var node = info.node;
        //if this node is already in the selection, we should ignore this
        if(localState.selectedNodes[node.id]) return;
        //if shift isn't pressed, then we need to clear the current selection
        if(!info.shiftKey) {
          dispatch("clearSelection", {}, true);
        }
        localState.selectedNodes[node.id] = node;
        //build a query with the selected things in it
      break;
      case "clearSelection":
        // diffs.push(api.remove("view", api.retrieve("view", {view: localState.selectedViewId})));
        localState.selectedNodes = {};
        localState.selectedViewId = uuid();
      break;
      case "removeSelection":
        for(let nodeId in localState.selectedNodes) {
          let node = localState.selectedNodes[nodeId];
          if(node.type === "relationship") {
            diffs = removeSource(node.id);
          } else if (node.type === "primitive") {
            diffs = removeSource(node.sourceId);
          }
        }
        dispatch("clearSelection", {}, true);
      break;
      case "startBoxSelection":
        //if shift isn't pressed, then we need to clear the current selection
        if(!info.shiftKey) {
          dispatch("clearSelection", {}, true);
        }
        localState.selecting = true;
        localState.boxSelection = {start: info.coords};
      break;
      case "continueBoxSelection":
        if(!localState.selecting) return;
        localState.boxSelection.end = info;
      break;
      case "endBoxSelection":
        if(localState.boxSelection && localState.boxSelection.end) {
          var boxSelectedNodes = getNodesInRectangle(localState.drawnUiActiveId, localState.boxSelection);
          boxSelectedNodes.forEach((info) => {
            let {node} = info;
            localState.selectedNodes[node.id] = node;
          });
        }
        localState.selecting = false;
        localState.boxSelection = false;
      break;
      //---------------------------------------------------------
      // Node positioning
      //---------------------------------------------------------
      case "setDragOffset":
        localState.dragOffsetX = info.x;
        localState.dragOffsetY = info.y;
      break;
      case "setNodePosition":
        var originalPosition = positions[info.node.id];
        var offsetLeft = info.pos.left - originalPosition.left;
        var offsetTop = info.pos.top - originalPosition.top;
        var selectionSize = 0;
        for(let nodeId in localState.selectedNodes) {
          let node = localState.selectedNodes[nodeId];
          let prevPosition = positions[node.id];
          positions[node.id] = {left: prevPosition.left + offsetLeft, top: prevPosition.top + offsetTop};
          selectionSize++;
        }
        // if we have only one thing selected we need to check for overlaps to show potential actions that
        // could take place
        if(selectionSize === 1) {
          localState.overlappingNodes = actionableIntersections(localState.drawnUiActiveId, info.node.id).lookup;
        } else {
          localState.overlappingNodes = {};
        }
      break;
      case "finalNodePosition":
       var selectionSize = 0;
       for(let nodeId in localState.selectedNodes) {
          let node = localState.selectedNodes[nodeId];
          let currentPos = positions[node.id];
          diffs.push(api.insert("editor node position", {node: nodeId, x: currentPos.left, y: currentPos.top}),
                     api.remove("editor node position", {node: nodeId}));
          selectionSize++;
        }
        // @TODO: Check for potential overlap with other nodes
        if(selectionSize === 1) {
          let {lookup, actions} = actionableIntersections(localState.drawnUiActiveId, info.node.id);
          for(let action of actions) {
            diffs.push.apply(diffs, dispatch(action.action, action, true));
          }
        }
      break;
      //---------------------------------------------------------
      // Navigation
      //---------------------------------------------------------
      case "openRelationship":
        localState.drawnUiActiveId = info.node.source["source: source view"];
        diffs = dispatch("clearSelection", {}, true);
      break;
      case "openQuery":
        localState.drawnUiActiveId = info.queryId;
      break;
      case "gotoQuerySelector":
        localState.drawnUiActiveId = false;
      break;
      //---------------------------------------------------------
      // Query building
      //---------------------------------------------------------
      case "createNewQuery":
        let newId = uuid();
        localState.drawnUiActiveId = newId;
        diffs = [
          api.insert("view", {view: newId, kind: "join", dependents: {"display name": {name: "New query!"}, "tag": [{tag: "remote"}]}})
        ];
      break;
      case "addViewToQuery":
        var sourceId = uuid();
        var queryId = localState.drawnUiActiveId;
        diffs = [
          api.insert("source", {view: queryId, source: sourceId, "source view": info.viewId})
        ];
        var sourceView = ixer.selectOne("view", {view: info.viewId});
        ixer.select("field", {view: info.viewId}).forEach(function(field) {
            let fieldId = field["field: field"];
            diffs.push.apply(diffs, addSourceFieldVariable(queryId, info.viewId, sourceId, fieldId));
        });
        //we may also have information about where we should position it.
        if(info.top !== undefined) {
          diffs.push(api.insert("editor node position", {node: sourceId, x: info.left, y: info.top}));
          positions[sourceId] = {left: info.left, top: info.top};
        }
      break;
      case "joinNodes":
        var {target, node} = info;
        if(!node || !target) throw new Error("Trying to join at least one non-existent node");
        var variableId = node.variable;
        var variableIdToRemove = target.variable;

        // transfer all the bindings to the new variable
        var oldBindings = ixer.select("binding (new)", {variable: variableIdToRemove});
        for(let binding of oldBindings) {
          let sourceId = binding["binding (new): source"];
          let fieldId = binding["binding (new): field"];
          diffs.push(api.insert("binding (new)", {variable: variableId, source: sourceId, field: fieldId}));
        }
        // check for an ordinal binding and move it over if it exists
        var ordinalBinding = ixer.selectOne("ordinal binding", {variable: variableIdToRemove});
        if(ordinalBinding) {
          diffs.push(api.insert("ordinal binding", {variable: variableId, source: ordinalBinding["ordinal binding: source"]}));
        }

        // remove the old variable
        diffs.push.apply(diffs, removeVariable(variableIdToRemove));

        //if either of these nodes are a primitive input, then we should remove any constant
        //constraint that was on there.
        var primitiveNode;
        var nonPrimitiveNode;
        if(target.isInput) {
          primitiveNode = target;
          nonPrimitiveNode = node;
        } else if(node.isInput) {
          primitiveNode = node;
          nonPrimitiveNode = target;
        }
        if(primitiveNode) {
          // ensure that these nodes can act as inputs:
          // if it's a vector input this has to be a non-grouped, sourceChunked attribute
          // if it's a scalar input this has to be either grouped or a non-sourceChunked attribute
          if(primitiveNode.inputKind === "vector input" && (nonPrimitiveNode.grouped || !nonPrimitiveNode.sourceChunked)) {
            //we do this as a normal dispatch as we want to bail out in the error case.
            return dispatch("setError", {errorText: "Aggregates require columns as input, try selecting the source and chunking it."});
          } else if(primitiveNode.inputKind === "scalar input" && !nonPrimitiveNode.grouped && nonPrimitiveNode.sourceChunked) {
            //we do this as a normal dispatch as we want to bail out in the error case.
            return dispatch("setError", {errorText: "Normal functions can't take columns as input, you could try unchunking the source or grouping this field."});
          }
          diffs.push(api.remove("constant (new)", {variable: primitiveNode.variable}));
        }
        diffs.push.apply(diffs, dispatch("clearSelection", info, true));
      break;
      case "unjoinNodes":
        var {fromNode} = info;
        var queryId = localState.drawnUiActiveId;
        var variableIdToRemove = fromNode.variable;
        var oldBindings = ixer.select("binding (new)", {variable: variableIdToRemove});
         // push all the bindings onto their own variables, skipping the first as that one can reuse
         // the current variable
        for(let binding of oldBindings.slice(1)) {
          let sourceId = binding["binding (new): source"];
          let fieldId = binding["binding (new): field"];
          let sourceViewId = ixer.selectOne("source", {source: sourceId})["source: source view"];
          diffs.push.apply(diffs, addSourceFieldVariable(queryId, sourceViewId, sourceId, fieldId));
          diffs.push(api.remove("binding (new)", {variable: variableIdToRemove, source: sourceId, field: fieldId}));
        }
        // check for an ordinal binding and create a new variable for it if it exists
        var ordinalBinding = ixer.selectOne("ordinal binding", {variable: variableIdToRemove});
        if(ordinalBinding) {
          diffs.push.apply(diffs, addSourceFieldVariable(queryId, null, ordinalBinding["ordinal binding: source"], "ordinal"));
          diffs.push(api.remove("ordinal binding", {variable: variableIdToRemove}));
        }
        // we have to check to make sure that if the original binding represents an input it gets a default
        // added to it to prevent the server from crashing
        var fieldId = oldBindings[0]["binding (new): field"];
        var kind = ixer.selectOne("field", {field: fieldId})["field: kind"];
        if(kind !== "output") {
          let sourceViewId = ixer.selectOne("source", {source: oldBindings[0]["binding (new): source"]})["source: source view"];
          diffs.push(api.insert("constant (new)", {variable: variableIdToRemove, value: api.newPrimitiveDefaults[sourceViewId][fieldId]}));
        }

      break;
      case "removeSelectFromQuery":
        var selects = ixer.select("select (new)", {view: info.viewId, variable: info.variableId}) || [];
        for(let select of selects) {
          let fieldId = select["select (new): field"];
          diffs.push(api.remove("field", {field: fieldId}));
        }
        diffs.push(api.remove("select (new)", {view: info.viewId, variable: info.variableId}));
      break;
      case "addSelectToQuery":
        var name = info.name;
        var fields = ixer.select("field", {view: info.viewId}) || [];
        var neueField = api.insert("field", {view: info.viewId, kind: "output", dependents: {
          "display name": {name: name},
          "display order": {priority: -fields.length}
        }});
        var fieldId = neueField.content.field;

        diffs = [
          neueField,
          api.insert("select (new)", {view: info.viewId, field: fieldId, variable: info.variableId})
        ];
      break;
      case "setQueryName":
        if(info.value === ixer.selectOne("display name", {id: info.viewId})["display name: name"]) return;
        diffs.push(api.insert("display name", {id: info.viewId, name: info.value}),
                   api.remove("display name", {id: info.viewId}));
      break;
      case "addFilter":
        var variableId = info.node.variable;
        diffs.push(api.insert("constant (new)", {variable: variableId, value: ""}));
        dispatch("modifyFilter", info, true);
      break;
      case "modifyFilter":
        localState.modifyingFilterNodeId = info.node.id;
      break;
      case "removeFilter":
        var variableId = info.node.variable;
        diffs.push(api.remove("constant (new)", {variable: variableId}));
      break;
      case "stopModifyingFilter":
        //insert a constant
        var variableId = info.node.variable;
        diffs.push(api.remove("constant (new)", {variable: variableId}));
        diffs.push(api.insert("constant (new)", {variable: variableId, value: info.value}));
        localState.modifyingFilterNodeId = undefined;
      break;
      case "chunkSource":
        var sourceId = info.node.source["source: source"];
        diffs.push(api.insert("chunked source", {view: info.viewId, source: sourceId}));
      break;
      case "unchunkSource":
        var sourceId = info.node.source["source: source"];
        diffs.push(api.remove("chunked source", {view: info.viewId, source: sourceId}));
      break;
      case "addOrdinal":
        var sourceId = info.node.source["source: source"];
        // @TODO: we need a way to create a variable for this to really work
        var fields = ixer.select("field", {view: info.viewId}) || [];
        var neueField = api.insert("field", {view: info.viewId, kind: "output", dependents: {
          "display name": {name: "ordinal"},
          "display order": {priority: -fields.length}
        }});
        var fieldId = neueField.content.field;
        var variableId = uuid();
        diffs.push(
          neueField,
          // create a variable
          api.insert("variable (new)", {view: info.viewId, variable: variableId}),
          // bind the ordinal to it
          api.insert("ordinal binding", {source: sourceId, variable: variableId}),
          // select the variable into the created field
          api.insert("select (new)", {view: info.viewId, variable: variableId, field: fieldId})
        );
      break;
      case "removeOrdinal":
        var sourceId = info.node.source["source: source"];
        var variableId = ixer.selectOne("ordinal binding", {source: sourceId})["ordinal binding: variable"];
        diffs = removeVariable(variableId);
      break;
      case "groupAttribute":
        var variableId = info.node.variable;
        var bindings = ixer.select("binding", {variable: variableId});
        if(bindings.length > 1) {
          //we do this as a normal dispatch as we want to bail out in the error case.
          return dispatch("setError", {errorText: "Cannot group an attribute that has multiple bindings, not sure what to do."});
          return;
        }
        var sourceId = bindings[0]["binding: source"];
        var fieldId = bindings[0]["binding: field"];
        diffs.push(api.insert("grouped field", {view: info.viewId, source: sourceId, field: fieldId}));
      break;
      case "ungroupAttribute":
        var variableId = info.node.variable;
        var bindings = ixer.select("binding", {variable: variableId});
        if(bindings.length > 1) {
          //we do this as a normal dispatch as we want to bail out in the error case.
          return dispatch("setError", {errorText: "Cannot group an attribute that has multiple bindings, not sure what to do."});
        }
        var sourceId = bindings[0]["binding: source"];
        var fieldId = bindings[0]["binding: field"];
        diffs.push(api.remove("grouped field", {view: info.viewId, source: sourceId, field: fieldId}));
      break;
      //---------------------------------------------------------
      // Errors
      //---------------------------------------------------------
      case "setError":
        var errorId = localState.errors.length;
        var newError: any = {text: info.errorText, time: api.now(), id: errorId};
        newError.errorTimeout = setTimeout(() => dispatch("fadeError", {errorId}), 2000);
        localState.errors.push(newError);
      break;
      case "fadeError":
        var errorId = info.errorId;
        var currentError = localState.errors[errorId];
        currentError.fading = true;
        currentError.errorTimeout = setTimeout(() => dispatch("clearError", {errorId: info.errorId}), 1000);
      break;
      case "clearError":
        // localState.errors = false;
      break;
      //---------------------------------------------------------
      // search
      //---------------------------------------------------------
      case "updateSearch":
        localState.searchingFor = info.value;
        localState.searchResults = searchResultsFor(info.value);
      break;
      case "startSearching":
        localState.searching = true;
        diffs.push.apply(diffs, dispatch("updateSearch", {value: info.value || ""}, true));
      break;
      case "stopSearching":
        localState.searching = false;
      break;
      case "handleSearchKey":
        if(info.keyCode === api.KEYS.ENTER) {
          // @TODO: execute an action
          let currentSearchGroup = localState.searchResults[0];
          if(currentSearchGroup && currentSearchGroup.results.length) {
            let results = currentSearchGroup.results;
            currentSearchGroup.onSelect(null, {result: currentSearchGroup.results[results.length - 1]});
          }
          diffs.push.apply(diffs, dispatch("stopSearching", {}, true));
        } else if(info.keyCode === api.KEYS.ESC) {
          diffs.push.apply(diffs, dispatch("stopSearching", {}, true));
        } else if(info.keyCode === api.KEYS.F && (info.ctrlKey || info.metaKey)) {
          diffs.push.apply(diffs, dispatch("stopSearching", {}, true));
          info.e.preventDefault();
        }
      break;
      //---------------------------------------------------------
      // Menu
      //---------------------------------------------------------
      case "showMenu":
        localState.menu = {top: info.y, left: info.x, contentFunction: info.contentFunction};
      break;
      case "clearMenu":
        localState.menu = false;
      break;
      default:
        console.error("Unknown dispatch:", event, info);
        break;
    }

    if(!rentrant) {
      if(diffs.length) {
        let formatted = api.toDiffs(diffs);
        ixer.handleDiffs(formatted);
        client.sendToServer(formatted, false);
      }
      render();
    }
    return diffs;
  }

  //---------------------------------------------------------
  // Search
  //---------------------------------------------------------

  function scoreHaystack(haystack, needle) {
    let score = 0;
    let found = {};
    let lowerHaystack = haystack.toLowerCase();
    if(needle.length === 1 && haystack === needle[0]) {
      score += 2;
    }
    for(let word of needle) {
      let ix = lowerHaystack.indexOf(word);
      if(ix === 0) {
        score += 1;
      }
      if(ix > -1) {
        score += 1;
        found[word] = ix;
      }
    }
    return {score, found};
  }

  function sortByScore(a, b) {
    let aScore = a.score.score;
    let bScore = b.score.score;
    if(aScore === bScore) {
      return b.text.length - a.text.length;
    }
    return aScore - bScore;
  }

  function searchResultsFor(searchValue) {
    let start = api.now();
    let needle = searchValue.trim().toLowerCase().split(" ");
    // search results should be an ordered set of maps that contain the kind of results
    // being provided, the ordered set of results, and a selection handler
    let searchResults = [];

    let rels = searchRelations(needle);
    if(rels) searchResults.push(rels);

    let glossary = searchGlossary(needle);
    if(glossary) searchResults.push(glossary);

    let end = api.now();
    if(end - start > 5) {
      console.error("Slow search (>5 ms):", end - start, searchValue);
    }
    return searchResults;
  }

  function searchRelations(needle) {
    let matchingViews = [];
    for(let view of ixer.select("view", {})) {
      let id = view["view: view"];
      let name = code.name(view["view: view"]);
      let score = scoreHaystack(name, needle);
      if(score.score) {
        let description = ixer.selectOne("view description", {view: id});
        if(description) {
          description = description["view description: description"];
        } else {
          description = "No description :(";
        }
        matchingViews.push({text: name, viewId: id, score, description});
      }
    }
    matchingViews.sort(sortByScore);
    return {kind: "Sources", results: matchingViews, onSelect: (e, elem) => {
      dispatch("addViewToQuery", {viewId: elem.result.viewId});
    }};
  }

  function searchGlossary(needle) {
    let matchingTerms = [];
    for(let term of glossary.terms) {
      let score = scoreHaystack(term.term, needle);
      if(score.score) {
        matchingTerms.push({text: term.term, description: term.description, score});
      }
    }
    matchingTerms.sort(sortByScore);
    return {kind: "Glossary", results: matchingTerms, onSelect: () => { console.log("selected glossary item")}};
  }

  //---------------------------------------------------------
  // root
  //---------------------------------------------------------

  function root() {
    var page:any;
    if(localState.drawnUiActiveId) {
      page = queryUi(localState.drawnUiActiveId, true);
    } else {
      page = querySelector();
    }
    return {id: "root", children: [page]};
  }

  function querySelector() {
    var queries = api.ixer.select("view", {kind: "join"}).map((view) => {
      var viewId = view["view: view"];
      return {c: "query-item", queryId: viewId, click: openQuery, children:[
        {c: "query-name", text: code.name(viewId)},
        queryUi(viewId)
      ]};
    });
    return {c: "query-selector-wrapper", children: [
      {c: "button", text: "add query", click: createNewQuery},
      {c: "query-selector", children: queries}
    ]};
  }

  function createNewQuery(e, elem) {
    dispatch("createNewQuery", {});
  }

  function openQuery(e, elem) {
    dispatch("openQuery", {queryId: elem.queryId});
  }

  function queryUi(viewId, showResults = false) {
    var view = ixer.selectOne("view", {view: viewId});
    if(!view) return;
    return {c: "query", children: [
      localState.drawnUiActiveId ? queryTools(view) : undefined,
      {c: "container", children: [
        {c: "surface", children: [
          {c: "query-name-input", contentEditable: true, blur: setQueryName, viewId: viewId, text: code.name(viewId)},
          queryMenu(view),
          queryCanvas(view),
          queryErrors(view),
        ]},
        showResults ? queryResults(viewId) : undefined
      ]}

    ]};
  }

  function queryErrors(view) {
    let errors = localState.errors.map((error) => {
      let klass = "error";
      if(error.fading) {
        klass += " fade";
      }
      return {c: klass, text: error.text};
    }).reverse();
    return {c: "query-errors", children: errors};
  }

  function queryTools(view) {
    // What tools are available depends on what is selected.
    // no matter what though you should be able to go back to the
    // query selector.
    let tools:any = [
       {c: "tool", text: "back", click: gotoQuerySelector},
    ];

    // @FIXME: what is the correct way to divy this up? The criteria for
    // what tools show up can be pretty complicated.

    let viewId = view["view: view"];

    // @FIXME: we ask for the entity info multiple times to draw the editor
    // we should probably find a way to do it in just one.
    let {nodeLookup} = viewToEntityInfo(view);

    let selectedNodes = Object.keys(localState.selectedNodes).map(function(nodeId) {
      // we can't rely on the actual nodes of the uiSelection because they don't get updated
      // so we have to look them up again.
      return nodeLookup[nodeId];
    });

    // no selection
    if(!selectedNodes.length) {
      tools.push.apply(tools, [
        {c: "tool", text: "Search", click: startSearching},
      ]);

    // single selection
    } else if(selectedNodes.length === 1) {
      let node = selectedNodes[0];
      if(node.type === "attribute") {
        if(node.mergedAttributes) {
          tools.push({c: "tool", text: "unmerge", click: unjoinNodes, node: node});
        }
        if(ixer.selectOne("select (new)", {view: viewId, variable: node.variable})) {
          tools.push({c: "tool", text: "unselect", click: unselectAttribute, node, viewId});
        } else {
          tools.push({c: "tool", text: "select", click: selectAttribute, node, viewId});
        }
        if(!node.filter) {
          tools.push({c: "tool", text: "add filter", click: addFilter, node, viewId});
        } else {
          tools.push({c: "tool", text: "change filter", click: modifyFilter, node, viewId});
          tools.push({c: "tool", text: "remove filter", click: removeFilter, node, viewId});
        }

        // if this node's source is chunked or there's an ordinal binding, we can group
        if(node.sourceChunked || node.sourceHasOrdinal) {
          if(node.grouped) {
            tools.push({c: "tool", text: "ungroup", click: ungroupAttribute, node, viewId});
          } else {
            tools.push({c: "tool", text: "group", click: groupAttribute, node, viewId});
          }

        }
      } else if(node.type === "relationship") {
        if(node.chunked) {
          tools.push({c: "tool", text: "unchunk", click: unchunkSource, node, viewId});
        } else {
          tools.push({c: "tool", text: "chunk", click: chunkSource, node, viewId});
        }
        if(node.hasOrdinal) {
          tools.push({c: "tool", text: "remove ordinal", click: removeOrdinal, node, viewId});
        } else {
          tools.push({c: "tool", text: "add ordinal", click: addOrdinal, node, viewId});
        }

      }

    //multi-selection
    } else {

    }
    return {c: "left-side-container", children: [
      {c: "query-tools", children: tools},
      querySearcher()
    ]};
  }

  function querySearcher() {
    if(!localState.searching) return;
    let results = localState.searchResults;
    let resultGroups = [];
    if(results) {
      resultGroups = results.map((resultGroup) => {
        let onSelect = resultGroup.onSelect;
        let items = resultGroup.results.map((result) => {
          return {c: "search-result-item", result, click: onSelect, children: [
            {c: "result-text", text: result.text},
            result.description ? {c: "result-description", text: result.description} : undefined,
          ]};
        });
        return {c: "search-result-group", children: [
          {c: "search-result-items", children: items},
          {c: "group-type", text: resultGroup.kind},
        ]}
      });
    }
    return {c: "searcher-container", children: [
      {c: "searcher-shade", click: stopSearching},
      {c: "searcher", children: [
        {c: "search-results", children: resultGroups},
        {c: "search-box", contentEditable: true, postRender: focusOnce, text: localState.searchingFor, input: updateSearch, keydown: handleSearchKey}
      ]}
    ]};
  }

  function handleSearchKey(e, elem) {
    dispatch("handleSearchKey", {keyCode: e.keyCode, metaKey: e.metaKey, ctrlKey: e.ctrlKey, e});
  }

  function startSearching(e, elem) {
    dispatch("startSearching", {value: elem.searchValue});
  }

  function stopSearching(e, elem) {
    dispatch("stopSearching", {});
  }

  function updateSearch(e, elem) {
    dispatch("updateSearch", {value: e.currentTarget.textContent});
  }

  function groupAttribute(e, elem) {
    dispatch("groupAttribute", {node: elem.node, viewId: elem.viewId});
  }

  function ungroupAttribute(e,elem) {
    dispatch("ungroupAttribute", {node: elem.node, viewId: elem.viewId});
  }

  function addOrdinal(e, elem) {
    dispatch("addOrdinal", {node: elem.node, viewId: elem.viewId});
  }

  function removeOrdinal(e, elem) {
    dispatch("removeOrdinal", {node: elem.node, viewId: elem.viewId});
  }


  function chunkSource(e, elem) {
    dispatch("chunkSource", {node: elem.node, viewId: elem.viewId});
  }

  function unchunkSource(e, elem) {
    dispatch("unchunkSource", {node: elem.node, viewId: elem.viewId});
  }

  function addFilter(e, elem) {
    dispatch("addFilter", {node: elem.node, viewId: elem.viewId});
  }

  function removeFilter(e, elem) {
    dispatch("removeFilter", {node: elem.node, viewId: elem.viewId});
  }

  function modifyFilter(e, elem) {
    dispatch("modifyFilter", {node: elem.node});
  }

  function unselectAttribute(e, elem) {
    dispatch("removeSelectFromQuery", {viewId: elem.viewId, variableId: elem.node.variable});
  }
  function selectAttribute(e, elem) {
    dispatch("addSelectToQuery", {viewId: elem.viewId, variableId: elem.node.variable, name: elem.node.name});
  }

  function queryResults(viewId) {
    let resultViewId = viewId;
    let selectedNodeIds = Object.keys(localState.selectedNodes);
    if(selectedNodeIds.length === 1 && localState.selectedNodes[selectedNodeIds[0]].type === "relationship") {
      resultViewId = localState.selectedNodes[selectedNodeIds[0]].source["source: source view"];
    }
    return {c: "query-results", children: [
      tableEditor.tableForView(resultViewId, false, 100)
    ]};
  }

  function setQueryName(e, elem) {
    dispatch("setQueryName", {viewId: elem.viewId, value: e.currentTarget.textContent});
  }

  function gotoQuerySelector(e, elem) {
    dispatch("gotoQuerySelector", {});
  }

  function queryMenu(query) {
    var menu = localState.menu;
    if(!menu) return {};
    return {c: "menu-shade", mousedown: clearMenuOnClick, children: [
      {c: "menu", top: menu.top, left: menu.left, children: [
        menu.contentFunction()
      ]}
    ]};
  }

  function clearMenuOnClick(e, elem) {
    if(e.target === e.currentTarget) {
      dispatch("clearMenu", {});
    }
  }

  function toPosition(node) {
    var random = {left: 100 + Math.random() * 300, top: 100 + Math.random() * 300};
    var key = node.id;
    if(!positions[key]) {
      positions[key] = random;
    }
    return positions[key];
  }

  function joinToEntityInfo(view) {
    var nodes = [];
    var nodeLookup = {};
    var constraints = [];
    var links = [];
    let viewId = view["view: view"];
    for(var source of ixer.select("source", {view: viewId})) {
      var sourceViewId = source["source: source view"];
      var sourceView = api.ixer.selectOne("view", {view: sourceViewId});
      if(!sourceView) {
        console.error("Source view not found for source:", source);
        continue;
      }
      var sourceId = source["source: source"];
      if(sourceView["view: kind"] !== "primitive") {
        var isRel = true;
        var curRel:any = {type: "relationship", source: source, id: sourceId, name: code.name(sourceViewId)};
        nodes.push(curRel);
        nodeLookup[curRel.id] = curRel;
        if(ixer.selectOne("chunked source", {source: sourceId, view: viewId})) {
          curRel.chunked = true;
        }
        if(ixer.selectOne("ordinal binding", {source: sourceId})) {
          curRel.hasOrdinal = true;
        }
      } else {
        var curPrim: any = {type: "primitive", sourceId: sourceId, primitive: sourceViewId, name: code.name(sourceViewId)};
        curPrim.id = curPrim.sourceId;
        nodes.push(curPrim);
        nodeLookup[curPrim.id] = curPrim;
      }
    }

    //look through the variables and dedupe attributes
    let variables = ixer.select("variable", {view: view["view: view"]});
    for(let variable of variables) {
      let variableId = variable["variable: variable"];
      let bindings = ixer.select("binding", {variable: variableId});
      let constants = ixer.select("constant*", {variable: variableId});
      let ordinals = ixer.select("ordinal binding", {variable: variableId});
      let attribute:any = {type: "attribute", id: variableId, variable: variableId};

       // if we have bindings, this is a normal attribute and we go through to create
       // links to the sources and so on.
      if(bindings.length) {
        let entity = undefined;
        let name = "";
        let singleBinding = bindings.length === 1;

        // check if an ordinal is bound here.
        if(ordinals.length) {
          let sourceNode = nodeLookup[ordinals[0]["ordinal binding: source"]];
          if(sourceNode) {
            let link: any = {left: attribute, right: sourceNode, name: "ordinal"};
            links.push(link);
          }
          name = "ordinal";
        }

        // run through the bindings once to determine if it's an entity, what it's name is,
        // and all the other properties of this node.
        for(let binding of bindings) {
          let sourceId = binding["binding: source"];
          let fieldId = binding["binding: field"];
          let fieldKind = ixer.selectOne("field", {field: fieldId})["field: kind"];
          if(!entity) entity = fieldToEntity[fieldId];
          // we don't really want to use input field names as they aren't descriptive.
          // so we set the name only if this is an output or there isn't a name yet
          if(fieldKind === "output" || !name) {
            name = code.name(fieldId);
          }
          // if it's a single binding and it's an input then this node is an input
          if(singleBinding && fieldKind !== "output") {
            attribute.isInput = true;
            attribute.inputKind = fieldKind;
          }
          let grouped = ixer.selectOne("grouped field", {source: sourceId, field: fieldId});
          if(grouped) {
            attribute.grouped = true;
          }
          let sourceNode = nodeLookup[sourceId];
          if(sourceNode) {
            attribute.sourceChunked = attribute.sourceChunked || sourceNode.chunked;
            attribute.sourceHasOrdinal = attribute.sourceHasOrdinal || sourceNode.hasOrdinal;
          }
        }


        // the final name of the node is either the entity name or the whichever name we picked
        name = entity || name;
        // now that it's been named, go through the bindings again and create links to their sources
        for(let binding of bindings) {
          let sourceId = binding["binding: source"];
          let fieldId = binding["binding: field"];
          let sourceNode = nodeLookup[sourceId];
          // @FIXME: because the client isn't authorative about code, there are cases where the source
          // is removed but the variable still exists. Once the AST is editor-owned, this will no longer
          // be necessary.
          if(!sourceNode) continue;
          let link: any = {left: attribute, right: sourceNode};
          let fieldName = code.name(fieldId);
          if(fieldName !== name) {
            link.name = fieldName;
          }
          links.push(link);
        }
        attribute.name = name;
        attribute.mergedAttributes = bindings.length + ordinals.length > 1 ? bindings : undefined;
        attribute.entity = entity;
        attribute.select = ixer.selectOne("select (new)", {variable: variableId});
        for(var constant of constants) {
          attribute.filter = {operation: "=", value: constant["constant*: value"]};
        }
      } else if(constants.length) {
        // some variables are just a constant
        attribute.name = "constant";
        attribute.filter = {operation: "=", value: constants[0]["constant*: value"]};
      } else if(ordinals.length) {
        // we have to handle ordinals specially since they're a virtual field on a table
        attribute.isOrdinal = true;
        attribute.name = "ordinal";
        attribute.select = ixer.selectOne("select (new)", {variable: variableId});
        let sourceNode = nodeLookup[ordinals[0]["ordinal binding: source"]];
        if(sourceNode) {
          let link: any = {left: attribute, right: sourceNode, name: "ordinal"};
          links.push(link);
        }
      } else {
        attribute.name = "unknown variable";
      }
      nodeLookup[attribute.id] = attribute;
      nodes.push(attribute);
    }

    return {nodes, links, nodeLookup};
  }

  function tableToEntityInfo(view) {
    var nodes = [];
    var links = [];
    let nodeLookup = {};
    return {nodes, links, nodeLookup};
  }

  function viewToEntityInfo(view) {
    if(view["view: kind"] === "join") {
      return joinToEntityInfo(view);
    } else if(view["view: kind"] === "table") {
      return tableToEntityInfo(view);
    } else {
      let nodes = [];
      let links = [];
      let nodeLookup = {};
      return {nodeLookup, nodes, links}
    }
  }

  function queryCanvas(view) {
    let viewId = view["view: view"];
    var {nodes, links} = viewToEntityInfo(view);
    var items = [];
    for(var node of nodes) {
      items.push(nodeItem(node, viewId));
    }
    var linkItems = [];
    for(var link of links) {
      var leftItem, rightItem;
      for(var item of items) {
        if(item.node === link.left) {
          leftItem = item;
          break;
        }
      }
      for(var item of items) {
        if(item.node === link.right) {
          rightItem = item;
          break;
        }
      }

      if(leftItem.left <= rightItem.left) {
      var fromLeft = leftItem.left + (leftItem.size.width / 2);
        var fromTop = leftItem.top + (leftItem.size.height / 2);
        var toLeft = rightItem.left + (rightItem.size.width / 2);
        var toTop = rightItem.top + (rightItem.size.height / 2);
      } else {
        var fromLeft = rightItem.left + (rightItem.size.width / 2);
        var fromTop = rightItem.top + (rightItem.size.height / 2);
        var toLeft = leftItem.left + (leftItem.size.width / 2);
        var toTop = leftItem.top + (leftItem.size.height / 2);
      }
      var color = "#bbb";
      var d = `M ${fromLeft} ${fromTop} L ${toLeft} ${toTop}`;

      var pathId = `${link.right.id} ${link.left.id} path`;
      linkItems.push({svg: true, id: pathId, t: "path", d: d, c: "link", stroke: color, strokeWidth: 1});
      linkItems.push({svg: true, t: "text", children: [
        {svg: true, t: "textPath", startOffset: "50%", xlinkhref: `#${pathId}`, text: link.name}
      ]});
    }
    let selection;
    if(localState.selecting) {
      let {start, end} = localState.boxSelection;
      if(end) {
        let topLeft = {x: start.x, y: start.y};
        let width = Math.abs(end.x - start.x);
        let height = Math.abs(end.y - start.y);
        if(end.x < start.x) {
          topLeft.x = end.x;
        }
        if(end.y < start.y) {
          topLeft.y = end.y;
        }
        selection = {svg: true, c: "selection-rectangle", t: "rect", x: topLeft.x, y: topLeft.y, width, height};
      }
    } else {
      let selectedNodeIds = Object.keys(localState.selectedNodes);
      if(selectedNodeIds.length) {
        let {top, left, width, height} = nodesToRectangle(selectedNodeIds.map((nodeId) => localState.selectedNodes[nodeId]));
        selection = {svg: true, c: "selection-rectangle", t: "rect", x: left - 10, y: top - 10, width: width + 20, height: height + 20};
      }
    }
    return {c: "canvas", contextmenu: showCanvasMenu, mousedown: startBoxSelection, mousemove: continueBoxSelection, mouseup: endBoxSelection, dragover: preventDefault, children: [
      {c: "selection", svg: true, width: "100%", height: "100%", t: "svg", children: [selection]},
      {c: "links", svg: true, width:"100%", height:"100%", t: "svg", children: linkItems},
      {c: "nodes", children: items}
    ]};
  }

  function surfaceRelativeCoords(e) {
    let surface:any = document.getElementsByClassName("surface")[0];
    let surfaceRect = surface.getBoundingClientRect();
    let x = e.clientX - surfaceRect.left;
    let y = e.clientY - surfaceRect.top;
    return {x, y};
  }

  function startBoxSelection(e, elem) {
    let coords = surfaceRelativeCoords(e);
    dispatch("startBoxSelection", {coords, shiftKey: e.shiftKey});
  }
  function continueBoxSelection(e, elem) {
    if(!localState.selecting || (e.clientX === 0 && e.clientY === 0)) return;
    dispatch("continueBoxSelection", surfaceRelativeCoords(e));
  }
  function endBoxSelection(e, elem) {
    dispatch("endBoxSelection", {});
  }
  function showCanvasMenu(e, elem) {
    e.preventDefault();
    dispatch("showMenu", {x: e.clientX, y: e.clientY, contentFunction: canvasMenu});
  }

  function canvasMenu() {
    var views = ixer.select("view", {}).filter((view) => {
      return true; //!api.code.hasTag(view["view: view"], "hidden"); // && view["view: kind"] !== "primitive";
    }).map((view) => {
      return {c: "item relationship", text: code.name(view["view: view"]), click: addViewToQuery, viewId: view["view: view"]};
    });
    views.sort(function(a, b) {
      return a.text.localeCompare(b.text);
    });
    return {c: "view-selector", children: views};
  }

  function addViewToQuery(e, elem) {
    var menu = localState.menu;
    dispatch("clearMenu", {}, true);
    dispatch("addViewToQuery", {viewId: elem.viewId, top: menu.top, left: menu.left});
  }

  function clearCanvasSelection(e, elem) {
    if(e.target === e.currentTarget && !e.shiftKey) {
      dispatch("clearSelection", {});
    }
  }

  function nodeDisplayInfo(curNode) {
    let text = curNode.name;
    let small = false;
    let {left, top} = toPosition(curNode);
    let height = nodeHeight + 2 * nodeHeightPadding;
    let width = Math.max(text.length * nodeWidthMultiplier + 2 * nodeWidthPadding, nodeWidthMin);
    if(small) {
      width = Math.max(text.length * nodeSmallWidthMultiplier + nodeWidthPadding, nodeWidthMin);
    }
    return {left, top, width, height, text};
  }

  function nodeItem(curNode, viewId): any {
    var content = [];
    var uiSelected = localState.selectedNodes[curNode.id];
    var overlapped = localState.overlappingNodes[curNode.id];
    var klass = "";
    if(uiSelected) {
      klass += " uiSelected";
    }
    if(curNode.select) {
      klass += " projected";
    }
    if(overlapped) {
      klass += " overlapped";
    }
    if(curNode.chunked) {
      klass += " chunked";
    }
    if((curNode.sourceChunked && !curNode.grouped) || curNode.inputKind === "vector input") {
      klass += " column";
    }
    klass += ` ${curNode.type}`;
    if (curNode.entity !== undefined) {
      klass += " entity";
    }
    if (curNode.filter && curNode.inputKind !== "vector input") {
      var op = curNode.filter.operation;
      var filterUi:any = {c: "attribute-filter", dblclick: modifyFilter, node: curNode, children: [
        //{c: "operation", text: curNode.filter.operation}
      ]};
      if(localState.modifyingFilterNodeId === curNode.id) {
        filterUi.children.push({c: "value", children: [
          {c: "filter-editor", contentEditable: true, postRender: focusOnce, keydown: submitOnEnter,
            blur: stopModifyingFilter, viewId, node: curNode, text: curNode.filter.value}
        ]});
      } else {
        filterUi.children.push({c: "value", text: curNode.filter.value});
      }
      content.push(filterUi);
    }
    var {left, top, width, height, text} = nodeDisplayInfo(curNode);
    var elem = {c: "item " + klass, selected: uiSelected, width, height,
                mousedown: selectNode, dblclick: openNode, draggable: true, dragstart: storeDragOffset,
                drag: setNodePosition, dragend: finalNodePosition, node: curNode, text};
    content.unshift(elem);
    return {c: "item-wrapper", top: top, left: left, size: {width, height}, node: curNode, selected: uiSelected, children: content};
  }

  function submitOnEnter(e, elem) {
    if(e.keyCode === api.KEYS.ENTER) {
      stopModifyingFilter(e, elem);
      e.preventDefault();
    }
  }

  function stopModifyingFilter(e, elem) {
    dispatch("stopModifyingFilter", {node: elem.node, value: coerceInput(e.currentTarget.textContent), viewId: elem.viewId});
  }

  function unjoinNodes(e, elem) {
    dispatch("unjoinNodes", {fromNode: elem.node});
  }

  function selectNode(e, elem) {
    e.stopPropagation();
    dispatch("selectNode", {node: elem.node, shiftKey: e.shiftKey});
  }

  function openNode(e, elem) {
    if(elem.node.type === "relationship") {
      dispatch("openRelationship", {node: elem.node});
    }
  }

  function storeDragOffset(e, elem) {
    var rect = e.currentTarget.getBoundingClientRect();
    e.dataTransfer.setDragImage(document.getElementById("clear-pixel"),0,0);
    dispatch("setDragOffset", {x: e.clientX - rect.left, y: e.clientY - rect.top});
  }

  function finalNodePosition(e, elem) {
    dispatch("finalNodePosition", {node: elem.node});
  }

  function setNodePosition(e, elem) {
    if(e.clientX === 0 && e.clientY === 0) return;
    let surface:any = document.getElementsByClassName("surface")[0];
    let surfaceRect = surface.getBoundingClientRect();
    let x = e.clientX - surfaceRect.left - api.localState.dragOffsetX;
    let y = e.clientY - surfaceRect.top - api.localState.dragOffsetY;
    dispatch("setNodePosition", {
      node: elem.node,
      pos: {left: x, top: y}
    });
  }

  //---------------------------------------------------------
  // auto completer
  //---------------------------------------------------------

  interface completion {
    text: string;
    value: any;
    class?: string;
  }

  function autoCompleter(completions: completion[]) {
    var items = completions.map(completionItem);
  }

  function completionItem(completion: completion) {
    return {c: `completion-item ${completion.class}`, text: completion.text, key: completion.value};
  }

  //---------------------------------------------------------
  // keyboard handling
  //---------------------------------------------------------

  document.addEventListener("keydown", function(e) {
    var KEYS = api.KEYS;
    //Don't capture keys if we're focused on an input of some kind
    var target: any = e.target;
    if(e.defaultPrevented
       || target.nodeName === "INPUT"
       || target.getAttribute("contentEditable")) {
      return;
    }

    //undo + redo
    if((e.metaKey || e.ctrlKey) && e.shiftKey && e.keyCode === KEYS.Z) {
      dispatch("redo", null);
    } else if((e.metaKey || e.ctrlKey) && e.keyCode === KEYS.Z) {
      dispatch("undo", null);
    }

    //remove
    if(e.keyCode === KEYS.BACKSPACE) {
      dispatch("removeSelection", null);
      e.preventDefault();
    }

    if((e.ctrlKey || e.metaKey) && e.keyCode === KEYS.F) {
      dispatch("startSearching", {value: ""});
      e.preventDefault();
    }


  });

  //---------------------------------------------------------
  // Go!
  //---------------------------------------------------------

  client.afterInit(() => {
    loadPositions();
    render();
  });
  window["dispatcher"] = {render: render};
}