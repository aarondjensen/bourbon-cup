import UIKit
import Capacitor
import FirebaseCore

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ── The native Firebase SDK ─────────────────────────────────
        // Reads GoogleService-Info.plist and creates the default FirebaseApp.
        // Without it the app builds, installs, launches — and then stops on
        // the launch image, which is the whole reason this line is commented.
        //
        // `@capacitor-firebase/authentication` and `-messaging` both construct
        // their native Firebase objects as the bridge loads plugins, before a
        // line of our JavaScript runs. With no default app configured the
        // authentication plugin raises a RuntimeError, the bridge surfaces it
        // as "JS Eval error A JavaScript exception occurred", React never
        // mounts, and the only thing on screen is the launch storyboard. The
        // real cause is one line up the log: "The default Firebase app has not
        // yet been configured."
        //
        // It is needed EVEN THOUGH capacitor.config.json sets
        // `skipNativeAuth: true`. That flag decides which SDK holds the
        // SESSION — the JS one, because Firestore and the security rules read
        // that token — and not whether the native SDK is initialised at all.
        // The plugin still needs a configured app to hand a credential back
        // from the system sheet.
        //
        // Capacitor's stock AppDelegate does not do this and `npx cap add ios`
        // would write the stock one again, so scripts/native-projects.test.js
        // asserts the call is still here.
        FirebaseApp.configure()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
