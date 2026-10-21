"""Admin fleet workflow routes (freeze/resume/candidate/drain/approve/rollback, status, timeline, events)
and the control-job poll those workflows need. Proxied to the gateway's /api/fleet and /api/control/jobs."""
from fastapi import Request

from .gateway import FLEET_ACTIONS, FLEET_MODEL_ID, JOB_ID
from .support import PREFIX, fail, gateway_path

FLEET_NOT_MANAGED = ("fleet_not_managed", "This model is not managed by the fleet controller (control_managed is off).")
JOB_NOT_FOUND = ("job_not_found", "This job does not exist.")
FLEET_AUDIT = {"freeze": "admin.fleet_frozen", "resume": "admin.fleet_resumed", "candidate": "admin.fleet_candidate_requested",
               "drain": "admin.fleet_drain_requested", "approve": "admin.fleet_approved", "rollback": "admin.fleet_rollback_requested"}


def attach_admin_fleet(application, ctx):
    base = PREFIX + "/admin/gateway/fleet"

    # Registered before /fleet/{model_id}/... so "events" is never read as a model id.
    @application.get(base + "/events")
    async def admin_fleet_events(request: Request, modelId: str = "", limit: int = 100):
        ctx.current_user(request, admin=True)
        if not 1 <= limit <= 500:
            fail("invalid_input", "Choose a limit from 1 to 500.")
        if modelId:
            gateway_path(modelId, FLEET_MODEL_ID)
        return await ctx.gateway_call(ctx.gateway.fleet_events, modelId or None, limit, not_found=FLEET_NOT_MANAGED)

    @application.get(base + "/{model_id}/status")
    async def admin_fleet_status(model_id: str, request: Request):
        ctx.current_user(request, admin=True)
        gateway_path(model_id, FLEET_MODEL_ID)
        return await ctx.gateway_call(ctx.gateway.fleet_status, model_id, not_found=FLEET_NOT_MANAGED)

    @application.get(base + "/{model_id}/timeline")
    async def admin_fleet_timeline(model_id: str, request: Request):
        ctx.current_user(request, admin=True)
        gateway_path(model_id, FLEET_MODEL_ID)
        return await ctx.gateway_call(ctx.gateway.fleet_timeline, model_id, not_found=FLEET_NOT_MANAGED)

    @application.post(base + "/{model_id}/{action}")
    async def admin_fleet_action(model_id: str, action: str, request: Request):
        # No body is read: the gateway's fleet writes take none, and the browser sends none.
        admin = ctx.current_user(request, admin=True)
        gateway_path(model_id, FLEET_MODEL_ID)
        if action not in FLEET_ACTIONS:
            fail("unknown_action", "That fleet action is not supported.")
        result = await ctx.gateway_call(ctx.gateway.fleet_action, model_id, action, not_found=FLEET_NOT_MANAGED)
        if result.get("job_id") is not None:
            details = {"jobId": result.get("job_id"), "state": result.get("state"), "phase": result.get("phase")}
        else:
            details = {"mode": result.get("mode")}
        ctx.audit(FLEET_AUDIT[action], admin, model_id, details)
        return result

    @application.get(PREFIX + "/admin/gateway/control/jobs/{job_id}")
    async def admin_control_job(job_id: str, request: Request):
        ctx.current_user(request, admin=True)
        gateway_path(job_id, JOB_ID)
        return await ctx.gateway_call(ctx.gateway.control_job, job_id, not_found=JOB_NOT_FOUND)
