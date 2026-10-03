package com.luna.heelmotion;

import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.app.Instrumentation;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real WebView, packaged textures, native touch input, and both animation states. */
@RunWith(AndroidJUnit4.class)
public final class MovementSmokeTest {
    private MainActivity activity;
    private WebView webView;
    private Instrumentation getInstrumentation() { return InstrumentationRegistry.getInstrumentation(); }

    private String evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] value = {null};
        getInstrumentation().runOnMainSync(() -> webView.evaluateJavascript(expression, result -> {
            value[0] = result;
            done.countDown();
        }));
        assertTrue("WebView callback timed out", done.await(60, TimeUnit.SECONDS));
        return value[0];
    }
    private JSONObject object(String expression) throws Exception {
        String result = evaluate("JSON.stringify(" + expression + ")");
        return new JSONObject(new JSONArray("[" + result + "]").getString(0));
    }
    private JSONObject snapshot() throws Exception {
        return object("window.__heelMotionSnapshot ? window.__heelMotionSnapshot() : {loaded:false}");
    }
    private void visualReady() throws Exception {
        CountDownLatch committed = new CountDownLatch(1);
        getInstrumentation().runOnMainSync(() -> webView.postVisualStateCallback(
            SystemClock.uptimeMillis(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    webView.postOnAnimation(() -> webView.postOnAnimation(committed::countDown));
                }
            }));
        assertTrue("WebView did not commit the updated UI", committed.await(60, TimeUnit.SECONDS));
    }
    private JSONObject waitForMode(String mode) throws Exception {
        long end = SystemClock.uptimeMillis() + 30000;
        JSONObject value = null;
        do {
            value = snapshot();
            if (mode.equals(value.optString("mode"))) return value;
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        fail("Did not enter " + mode + ": " + value);
        return value;
    }
    private JSONObject waitFor(String state, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        JSONObject value = null;
        do {
            value = snapshot();
            if (value.optBoolean("loaded") && value.optInt("frames") > 0 && state.equals(value.optString("state"))) return value;
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        fail("Did not reach " + state + ": " + value);
        return value;
    }
    private void waitForWeight(String clip, double minimum, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        JSONObject value = null;
        do {
            value = snapshot();
            JSONObject weights = value.optJSONObject("weights");
            if (weights != null && weights.optDouble(clip) >= minimum) return;
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        fail("Animation weight did not reach " + minimum + " for " + clip + ": " + value);
    }
    private float[] point(String element, double yFraction) throws Exception {
        JSONObject rect = object("(()=>{const r=document.getElementById('" + element
            + "').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*"
            + yFraction + ",width:innerWidth};})()");
        int[] origin = new int[2];
        int[] width = new int[1];
        getInstrumentation().runOnMainSync(() -> {
            webView.getLocationOnScreen(origin);
            width[0] = webView.getWidth();
        });
        double scale = width[0] / rect.getDouble("width");
        return new float[]{origin[0] + (float)(rect.getDouble("x") * scale),
            origin[1] + (float)(rect.getDouble("y") * scale)};
    }
    private void touch(long start, int action, float[] xy) {
        MotionEvent.PointerProperties property = new MotionEvent.PointerProperties();
        property.id = 0;
        property.toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords coordinate = new MotionEvent.PointerCoords();
        coordinate.x = xy[0]; coordinate.y = xy[1];
        coordinate.pressure = 1; coordinate.size = .15f;
        MotionEvent event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, 1,
            new MotionEvent.PointerProperties[]{property}, new MotionEvent.PointerCoords[]{coordinate},
            0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        getInstrumentation().sendPointerSync(event);
        event.recycle();
    }
    private void secondTouch(long start, int action, float[] first, float[] second) {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[2];
        MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[2];
        for (int i = 0; i < 2; i++) {
            properties[i] = new MotionEvent.PointerProperties();
            properties[i].id = i;
            properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new MotionEvent.PointerCoords();
            float[] xy = i == 0 ? first : second;
            coordinates[i].x = xy[0]; coordinates[i].y = xy[1];
            coordinates[i].pressure = 1; coordinates[i].size = .15f;
        }
        MotionEvent event = MotionEvent.obtain(start, SystemClock.uptimeMillis(),
            action | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, properties, coordinates,
            0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        getInstrumentation().sendPointerSync(event);
        event.recycle();
    }

    private void tap(String id) throws Exception {
        // JS readiness can precede Chromium's compositor/hit-test update,
        // particularly during the first heavy GLB frame on SwiftShader.
        visualReady();
        float[] xy = point(id, .5);
        System.out.println("Native tap " + id + " at " + xy[0] + "," + xy[1]);
        long start = SystemClock.uptimeMillis();
        touch(start, MotionEvent.ACTION_DOWN, xy);
        SystemClock.sleep(80);
        touch(start, MotionEvent.ACTION_UP, xy);
        visualReady();
    }
    private void click(String action, String value) throws Exception {
        evaluate("document.querySelector('[data-action=\"" + action + "\"]"
            + (value == null ? "" : "[data-value=\"" + value + "\"]") + "').click()");
    }
    private void teleport(String area, double x, double z) throws Exception {
        evaluate("window.__lifeTest.teleport('" + area + "'," + x + "," + z + ")");
    }
    private void start() {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.setClassName(getInstrumentation().getTargetContext(), MainActivity.class.getName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("diagnostics", true);
        activity = (MainActivity)getInstrumentation().startActivitySync(intent);
        getInstrumentation().runOnMainSync(() -> webView = activity.getTestWebView());
    }

    @Test public void testOfflineLifeAndMultiTouch() throws Exception {
        start();
        try {
            JSONObject initial = waitFor("待机", 180000);
            assertEquals("main", initial.getString("mode"));
            assertEquals(4, initial.getJSONArray("animations").length());
            assertEquals(8, initial.getJSONArray("npcs").length());
            assertEquals(2.2, initial.getDouble("cameraDistance"), .001);
            assertEquals("appassets.androidplatform.net", initial.getString("host"));
            tap("new-game");
            if ("new-confirm".equals(snapshot().optString("modal"))) click("new", null);
            waitForMode("play");
            assertEquals("home", snapshot().getJSONObject("player").getString("area"));
            teleport("city", 0, 0);
            float[] center = point("joystick", .5), forward = point("joystick", .16);
            long touchStart = SystemClock.uptimeMillis();
            touch(touchStart, MotionEvent.ACTION_DOWN, center);
            touch(touchStart, MotionEvent.ACTION_MOVE, forward);
            JSONObject walking = waitFor("走路", 20000);
            assertTrue(walking.getDouble("speed") > .035);
            float[] runButton = point("run", .5);
            secondTouch(touchStart, MotionEvent.ACTION_POINTER_DOWN, forward, runButton);
            SystemClock.sleep(150);
            secondTouch(touchStart, MotionEvent.ACTION_POINTER_UP, forward, runButton);
            JSONObject running = waitFor("跑步", 20000);
            assertTrue("Second finger toggles run", running.getBoolean("running"));
            assertTrue(running.getDouble("speed") > .95);
            touch(touchStart, MotionEvent.ACTION_UP, forward);
            waitFor("待机", 20000);
            tap("aim");
            waitFor("瞄准待机", 20000);
            waitForWeight("Rifle_Aim_Idle", .99, 20000);
            tap("aim");
            assertTrue("Feet contact the scaled city", snapshot().getDouble("shoeClearance") >= -.002);

            // Main-menu -> safehouse -> city -> NPC -> shop -> reward -> save.
            teleport("home", 0, 11.9);
            tap("interact"); click("accept", "new-life"); tap("close-panel");
            teleport("home", 0, 7.9); tap("interact");
            assertEquals("city", snapshot().getJSONObject("player").getString("area"));
            teleport("city", -1.1, -2.5); tap("interact");
            assertEquals("dialog", snapshot().getString("modal"));
            click("gift", null); click("shop", null); click("buy", "city-bag");
            click("buy", "night-dress"); click("wardrobe", null); click("outfit", "night");
            tap("close-panel");
            teleport("city", -3.1, 2.2); tap("interact");
            JSONObject player = snapshot().getJSONObject("player");
            assertEquals(420, player.getInt("money"));
            assertEquals("new-life", player.getJSONObject("mission").getJSONArray("completed").getString(0));
            assertEquals("night", player.getJSONObject("outfit").getString("preset"));
            tap("pause"); click("settings", null); click("save", null); tap("close-panel");
            getInstrumentation().runOnMainSync(() -> activity.finish());
            start();
            waitFor("待机", 180000);
            tap("continue-game");
            waitForMode("play");
            JSONObject restored = snapshot().getJSONObject("player");
            assertEquals("Money survives a new WebView", 420, restored.getInt("money"));
            assertEquals("Outfit survives a new WebView", "night", restored.getJSONObject("outfit").getString("preset"));
            assertEquals("Completed quest survives", 1, restored.getJSONObject("mission").getJSONArray("completed").length());
            teleport("city", 0, 2);
            SystemClock.sleep(1200);
            assertNull("No local storage error", snapshot().opt("saveError") == JSONObject.NULL ? null : snapshot().opt("saveError"));
        } finally {
            Bitmap diagnostic = getInstrumentation().getUiAutomation().takeScreenshot();
            if (diagnostic != null) {
                File file = new File(getInstrumentation().getTargetContext().getFilesDir(), "test-preview.png");
                try (FileOutputStream stream = new FileOutputStream(file)) {
                    diagnostic.compress(Bitmap.CompressFormat.PNG, 100, stream);
                }
                diagnostic.recycle();
            }
            getInstrumentation().runOnMainSync(() -> activity.finish());
        }
    }
}
