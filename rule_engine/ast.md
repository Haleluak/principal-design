# Abstract Syntax Tree (AST) & Execution Engine Design

This document details the data structures, parsing processes, and execution mechanisms for the Rule Engine's Abstract Syntax Tree (AST). It is designed to serve as a comprehensive reference for the system's architecture and logic flow.

---

## 1. Node Data Structure (`ast/ast.go`)

The system utilizes an Abstract Syntax Tree (AST) to represent logical rules. Each element within this tree is a `Node`.

```go
type Node struct {
    Type  string  `json:"type"`            // Category: "operator", "condition", "arithmetic", "value", "function"
    Value string  `json:"value,omitempty"`  // Identifier or literal value (e.g., AND, OR, +, 18, 'active', ABS)
    Left  *Node   `json:"left,omitempty"`   // Pointer to the left child Node
    Right *Node   `json:"right,omitempty"`  // Pointer to the right child Node
    Field string  `json:"field,omitempty"`  // Property name in the actual data context (e.g., "age")
    Op    string  `json:"op,omitempty"`     // Comparison/Logical operator (e.g., >, <, =, !=)
    Args  []*Node `json:"args,omitempty"`   // List of parameters (specifically for Type: "function")
}
```

---

## 2. Initialization & Combination (Lifecycle)

The system supports two primary methods for initializing rules to ensure flexibility and reusability:

### A. String Parsing (`Parsing via CreateRule`)
When provided with a rule string (in Infix notation), the Parser performs the following:
1. **Lexical Analysis:** Tokenizes the string into individual components (e.g., `age`, `>`, `18`, `AND`).
2. **Syntactic Analysis:** Constructs the AST from tokens based on operator parsing precedence.
   - Example: `age > 18 AND status = 'active'` generates a Root Node of `AND` with two child leaf nodes representing the comparison conditions.

### B. Rule Combination (`Rule Combination via CombineRules`)
This mechanism allows for the reuse and aggregation of multiple independent rules into a complex composite rule set:
- **Mechanism:** Creates a logical Root Node (defaulting to `AND`) to link existing ASTs.
- **Application:** Ideal for combining system-wide base rules with user-specific custom rules.

**Tree Structure Representation (ASCII):**
```text
          [Root: AND]
          /         \
   [Left: Condition] [Right: Condition]
     (age > 18)      (status = 'active')
```

---

## 3. Evaluation Engine Mechanism

The core logic for rule evaluation resides in the recursive function `EvaluateNode`.

### Execution Pipeline:

1.  **Tree Traversal (Post-order Traversal):** The engine traverses the tree bottom-up (or top-down depending on operator short-circuit logic).
2.  **Context Injection (Context Lookup):** 
    - At **Condition** nodes, the Engine uses the `Field` property to look up actual values in the provided data record (usually a JSON payload or Context Map).
3.  **Operand Resolution (Value Resolution):**
    - If it encounters an **Arithmetic** (Calculation) or **Function** node, the system computes the intermediate value before proceeding to the next step.
4.  **Logical Evaluation (Comparison):**
    - Compares the actual retrieved/calculated value against the Node's `Value` based on the specified `Op` (operator).
    - For consistency and centralized handling, numerical data is typically cast to `float64`.

---

## 4. System Component Summary

| Phase | Task Description | Logical Component |
| :--- | :--- | :--- |
| **Parsing** | Transforms Domain Specific Language (DSL) into an AST | `ast/parser.go` |
| **Merging** | Combines multiple ASTs into a single hierarchical structure | `ast/parser.go` |
| **Traversing** | Recursively traverses the tree to evaluate the logic | `ast/ast.go` |
| **Calculating** | Computes arithmetic expressions and extended functions | `ast/ast.go` |

---

## 5. Advanced Features

### Short-circuit Evaluation (Logic Optimization)
To enhance performance, the Engine implements **Short-circuiting**:
- **For `AND` operators:** If the left branch evaluates to `false`, the right branch evaluation is skipped (as the final result is guaranteed to be `false`).
- **For `OR` operators:** If the left branch evaluates to `true`, the right branch evaluation is skipped (as the final result is guaranteed to be `true`).

### Handling Arithmetic & Functions
The Engine allows evaluating complex expressions before checking conditions:
- **Arithmetic:** Supports inline addition, subtraction, multiplication, and division directly within the rule.
- **Extensible Functions:** Supports mathematical functions (like `ABS`, `CEIL`) or custom business logic functions.

---

## 6. Detailed Execution Flow

Consider an evaluation scenario with the data payload: `{"age": 20, "status": "active"}` and the rule `age > 18 AND status = 'active'`.

**Step-by-Step Evaluation:**

1.  **Initiation (Root Trace):** The Engine invokes `EvaluateNode(Node: AND)`.
2.  **Left Branch Evaluation:**
    -   **Lookup:** Retrieves the `age` field from the actual data -> Result: `20`.
    -   **Comparison:** `20 > 18` -> Returns `TRUE`.
3.  **Right Branch Evaluation:**
    -   *Note: This is only executed because the left branch returned TRUE (Short-circuit optimization).*
    -   **Lookup:** Retrieves the `status` field from the actual data -> Result: `"active"`.
    -   **Comparison:** `"active" == "active"` -> Returns `TRUE`.
4.  **Final Aggregation:** `TRUE AND TRUE` -> Final returned result: **SUCCESS**.

**Execution Flow Diagram (ASCII):**
```text
   [App] --calls--> [Node: AND]
                      |
        +-------------+-------------+
        | (Logical Check)           |
        v                           v
  [Node: age > 18]           [Node: status = 'active']
  | (Fetch Data: 20)         | (Fetch Data: 'active')
  | Compare: 20 > 18         | Compare: 'active' == 'active'
  | Result: TRUE             | Result: TRUE
        |                           |
        +------------> AND <--------+
                      |
               [Final: SUCCESS]
```

---

## 7. JSON Representation Examples

Below are examples of how the AST data is structured in memory or transmitted via API boundaries. This is the most intuitive way to visualize the tree structure:

### A. Complex Rule: `age > 18 AND status = 'active'`
```json
{
  "type": "operator",
  "value": "AND",
  "left": {
    "type": "condition",
    "field": "age",
    "op": ">",
    "value": "18"
  },
  "right": {
    "type": "condition",
    "field": "status",
    "op": "=",
    "value": "active"
  }
}
```

### B. Computed Rule: `ABS(balance) < 1000`
```json
{
  "type": "condition",
  "op": "<",
  "value": "1000",
  "left": {
    "type": "function",
    "value": "ABS",
    "args": [
      {
        "type": "value",
        "field": "balance"
      }
    ]
  }
}
```

### C. Simple Rule: `age > 18`
```json
{
  "type": "condition",
  "field": "age",
  "op": ">",
  "value": "18"
}
```

---

*Note: The AST is intentionally designed to easily serialize/deserialize into JSON format for robust database storage and network transmission.*
