"""core：用例与领域规则（纯 Python）。

依赖方向：只 import 同包模块与 ports，★ 禁止 import fastapi / adapters。
adapters 的实现由 main.py 构造后注入各用例的构造函数。
"""
