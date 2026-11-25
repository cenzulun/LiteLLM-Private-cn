"""Sanitized model inventory for the token-focused overview."""
from fastapi import APIRouter
from realai_private.monitor_config import Actor, require_admin


def fleet_router():
    router = APIRouter(prefix="/private/fleet", tags=["模型使用总览"])

    @router.get("/inventory")
    async def inventory(actor: Actor):
        require_admin(actor)
        from litellm.proxy import proxy_server
        active = proxy_server.llm_router
        rows = active.registry().deployments() if active is not None else []
        models = {}
        for row in rows:
            name = row.get("model_name")
            if not isinstance(name, str):
                continue
            current = models.setdefault(name, {"model": name, "deployments": 0})
            current["deployments"] += 1
        return {"models": sorted(models.values(), key=lambda row: row["model"]), "deployment_count": len(rows)}

    return router
