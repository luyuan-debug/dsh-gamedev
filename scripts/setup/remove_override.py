"""Plan one owned override removal without constructing objects or dumping YAML.

stdout is private machine data consumed in memory by setup.mjs, never a log.
All diagnostics are fixed codes and contain no YAML, paths or config values.
"""
import base64
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode
from yaml.tokens import AliasToken, AnchorToken, BlockEntryToken, FlowEntryToken


class Refusal(Exception):
    pass


def document(text):
    try:
        tokens = list(yaml.scan(text, Loader=yaml.SafeLoader))
        if any(isinstance(token, (AliasToken, AnchorToken)) for token in tokens):
            raise Refusal("aliases_or_anchors")
        documents = list(yaml.compose_all(text, Loader=yaml.SafeLoader))
    except yaml.YAMLError:
        raise Refusal("invalid_yaml") from None
    if len(documents) > 1:
        raise Refusal("multiple_documents")
    root = documents[0] if documents else None
    if root is not None and not isinstance(root, SequenceNode):
        raise Refusal("root_not_sequence")
    budget = [0]

    def validate(node, depth=0):
        budget[0] += 1
        if depth > 40 or budget[0] > 20000:
            raise Refusal("document_too_complex")
        allowed = {"str", "null", "bool", "int", "float", "timestamp", "seq", "map"}
        if node.tag not in {"tag:yaml.org,2002:" + tag for tag in allowed}:
            raise Refusal("unsupported_tag")
        if isinstance(node, MappingNode):
            seen = set()
            for key, value in node.value:
                if not isinstance(key, ScalarNode) or key.tag != "tag:yaml.org,2002:str":
                    raise Refusal("non_string_mapping_key")
                if key.value in seen:
                    raise Refusal("duplicate_mapping_key")
                seen.add(key.value)
                validate(key, depth + 1)
                validate(value, depth + 1)
        elif isinstance(node, SequenceNode):
            for child in node.value:
                validate(child, depth + 1)

    if root is not None:
        validate(root)
    return root, tokens


def target_index(root):
    ids = set()
    target = None
    named = None
    for index, row in enumerate(root.value if root else []):
        if not isinstance(row, MappingNode):
            raise Refusal("row_not_mapping")
        fields = {key.value: value for key, value in row.value}
        values = {}
        for key in ("id", "name"):
            if key in fields:
                value = fields[key]
                if not isinstance(value, ScalarNode) or value.tag != "tag:yaml.org,2002:str":
                    raise Refusal("invalid_row_identity")
                values[key] = value.value
        if "id" in values:
            if values["id"] in ids:
                raise Refusal("duplicate_row_id")
            ids.add(values["id"])
        if values.get("id") == "gamedev-settings":
            if values.get("name") != "dsh-gamedev":
                raise Refusal("owned_id_rebound")
            target = index
        if values.get("name") == "dsh-gamedev":
            if named is not None or values.get("id") != "gamedev-settings":
                raise Refusal("ambiguous_owned_name")
            named = index
    if target != named:
        raise Refusal("ambiguous_owned_identity")
    return target


def semantic(node):
    if node is None:
        return ("tag:yaml.org,2002:seq", [])
    if isinstance(node, ScalarNode):
        return (node.tag, node.value)
    if isinstance(node, MappingNode):
        return (node.tag, [(semantic(key), semantic(value)) for key, value in node.value])
    return (node.tag, [semantic(child) for child in node.value])


def content_end(node):
    if isinstance(node, ScalarNode) or node.flow_style:
        return node.end_mark.index
    children = [child for pair in node.value for child in pair] if isinstance(node, MappingNode) else node.value
    return max((content_end(child) for child in children), default=node.start_mark.index)


def plan(data, expected):
    digest = hashlib.sha256(data).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}", expected) or digest != expected:
        raise Refusal("source_changed")
    if len(data) > 1024 * 1024:
        raise Refusal("document_too_large")
    try:
        text = data.decode("utf-8")
    except UnicodeError:
        raise Refusal("invalid_utf8") from None
    root, tokens = document(text)
    index = target_index(root)
    replacement = text
    if index is not None:
        row = root.value[index]
        start, end = row.start_mark.index, content_end(row)
        if root.flow_style:
            if index + 1 < len(root.value):
                separators = [token for token in tokens if isinstance(token, FlowEntryToken) and row.end_mark.index <= token.start_mark.index < root.value[index + 1].start_mark.index]
                if len(separators) != 1:
                    raise Refusal("ambiguous_row_span")
                end = separators[0].end_mark.index
            elif index:
                separators = [token for token in tokens if isinstance(token, FlowEntryToken) and root.value[index - 1].end_mark.index <= token.start_mark.index < row.start_mark.index]
                if len(separators) != 1:
                    raise Refusal("ambiguous_row_span")
                start = separators[0].start_mark.index
            insert = ""
        else:
            entries = [token for token in tokens if isinstance(token, BlockEntryToken) and token.start_mark.column == root.start_mark.column and token.end_mark.index <= row.start_mark.index]
            if not entries:
                raise Refusal("ambiguous_row_span")
            start = entries[-1].start_mark.index
            insert = "[]" if len(root.value) == 1 else ""
        replacement = text[:start] + insert + text[end:]
        remaining, _ = document(replacement)
        if target_index(remaining) is not None:
            raise Refusal("target_not_removed")
        expected_rows = [semantic(child) for i, child in enumerate(root.value) if i != index]
        if semantic(remaining) != (root.tag, expected_rows):
            raise Refusal("unrelated_content_changed")
    output = replacement.encode("utf-8")
    return {"sourceSHA256": digest, "changed": index is not None,
            "replacementSHA256": hashlib.sha256(output).hexdigest(),
            "replacementBase64": base64.b64encode(output).decode("ascii")}


def main():
    if len(sys.argv) != 3:
        raise Refusal("invalid_arguments")
    file = Path(sys.argv[1])
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Refusal("source_not_regular")
    if info.st_size > 1024 * 1024:
        raise Refusal("document_too_large")
    print(json.dumps(plan(file.read_bytes(), sys.argv[2]), separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Refusal as error:
        print("DSH_GAMEDEV_OVERRIDE_ERROR:" + str(error), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("DSH_GAMEDEV_OVERRIDE_ERROR:unavailable", file=sys.stderr)
        sys.exit(2)
